# Current Equipment Stats and Affixes Audit

> Snapshot date: 2026-07-13  
> Scope: the current working tree, including uncommitted changes  
> Primary sources: [`src/Item.js`](../src/Item.js), [`src/LootSystem.js`](../src/LootSystem.js), [`src/Player.js`](../src/Player.js), [`src/EquipmentManager.js`](../src/EquipmentManager.js), [`src/CombatSystem.js`](../src/CombatSystem.js), [`src/ProjectileSystem.js`](../src/ProjectileSystem.js), and [`src/Game.js`](../src/Game.js)

## Executive summary

The current system is broad but not internally reliable enough to balance by tooltip or `getPowerScore()` alone. It contains 38 item types, 26 random affixes, six rarities, and useful weapon-specific behavior, but stat meaning changes by weapon family and some obtainable rolls have no runtime effect.

The largest decision-relevant findings are:

- Four random affixes are completely inert: **Dash Recovery, Burn Resistance, Shock Resistance, and Elite Detection**. Knockback Resistance is also an inert base stat on Servo Boots. These values still increase the displayed power score.
- All ten legendary unique-effect descriptions are tooltip-only. Their forced numerical affixes work, but none of the described unique mechanics is keyed or consumed at runtime.
- Buster combat builds a partly separate stat object. It always replaces global Attack, Energy, Range, Rapid, Energy Recharge, and Cooldown Reduction with Buster-local values. Modules, armor, cores, and temporary bonuses to those fields can therefore be ignored while using the Buster. Other Buster-local fields overwrite global totals only when present, producing inconsistent stacking.
- “Weak-Point Damage” is actually the multiplier for random critical hits. Geometric weak-point hits are a separate enemy mechanic and do not read this stat.
- Area Output is stronger than its wording suggests: it multiplies direct damage for essentially every player attack and also expands selected arcs, explosions, mines, and ground effects. On explosive projectiles, the same rolled shot can deal a direct hit plus a 62%-damage explosion, both derived from the Area-amplified roll.
- Item stats scale forever with item level: base rolls gain 5.5% of their raw range per level and affixes gain 3.5% per level, both multiplied again by rarity. There is no player/item level cap or diminishing return in generation.
- Several weapon stats are contextual or quantized. Extra projectiles and pierce can be worthless on incompatible arms, Sword Range only converts at 24% efficiency and caps, Drill contact Range does not scale, and integer rounding creates breakpoints.

The strongest part worth preserving is the weapon-profile layer: arms already have distinct resource costs, output behavior, damage multipliers, range rules, status behavior, and cadence. The weakest part is the generic additive item/affix layer placed on top of those profiles.

## 1. Player and loadout baseline

### Base character stats

The player begins at level 1 with the following values from `PLAYER_BASE_STATS`:

| Stat | Base | Current effect |
|---|---:|---|
| Max HP | 160 | Health pool; equipment changes preserve current health percentage. |
| Movement Speed | 6.2 | Forward movement speed; running multiplies it by 1.68. |
| Attack | 12 | Global starting Attack for non-Buster arms. |
| Energy | 8 | Shared maximum for non-Buster arm Energy calculations. |
| Energy Recharge | 1.00 | Shortens manual/empty reload time; it is not passive Energy regeneration. |
| Rapid | 1.25 | Non-Buster cadence and weapon-output efficiency. |
| Range | 6.2 | Global starting range, interpreted differently by each arm. |
| Critical Chance | 8% | Random critical roll on player attacks. |
| Critical Damage | 1.55x | Random critical multiplier; displayed as Weak-Point Damage. |
| Armor | 4 | Reduces incoming damage using `100 / (100 + Armor)`. |
| Pickup Radius | 1.35 | Radius used to collect item/refractor pickups. |
| Projectiles | 1 | Base projectile count. |
| Pierce | 1 | Base pierce count before weapon profile bonuses. |
| All other defined combat stats | 0 | Area, elements, life steal, procs, cooldown, lock-on, Armor Break, Dash Recovery, and Swap Speed. |

On every level-up, the player permanently gains `+10 Max HP`, `+1.5 Attack`, and `+0.04 Pickup Radius`. No other base stat grows. Experience-to-next-level becomes `round(previous × 1.35 + 15)`. There is no level cap.

### Equip topology

`EquipmentManager` exposes `weapon`, `offhand`, `head`, `chest`, `hands`, `feet`, `module1`, `module2`, `core`, and `back`. The generated catalog currently has no `back` item. Modules occupy two slots. The player also owns:

- Four arm hotbar slots, with slot 1 reserved for the Buster path.
- A utility-arm collection/cycle for Lift and Drill behavior.
- Four dedicated Buster-upgrade slots. These are separate from the ordinary `hands` entry and their totals are summed by `getBusterUpgradeStatBonuses()`.

Ordinary equipped item totals are additive: base item stats plus affixes, then all equipped items are added to the player baseline. Temporary map-event bonuses are added afterward. Key clamps are 85% Critical Chance, 75% Cooldown Reduction, 85% Armor Break Chance, 85% Stagger Resistance, a 0.25 Rapid floor, and minimum 1 HP/Energy.

### Buster-specific aggregation warning

The Buster does not simply use the final player sheet. `_getBusterStatTotals()` starts with Buster defaults (`8 Attack`, `6 Energy`, `6.9 Range`, `0.10 Rapid`), overlays the active Buster item's totals, then adds the four Buster-upgrade items. `_getCombatStatsForProfile()` overlays that object onto the global player sheet.

Consequences:

1. Buster Attack, Energy, Range, Rapid, Energy Recharge, and Cooldown Reduction always replace the corresponding global totals. Bonuses to those fields from chest armor, boots, utility modules, the core, or map events do not affect Buster firing unless they are also present in the Buster-local object.
2. Critical Chance, Critical Damage, Area Output, elemental damage, projectile count, pierce, and proc stats remain global when absent locally, but a Buster/Buster-upgrade roll for one of them replaces—not adds to—the global total.
3. The same Buster upgrades are placed on the global sheet while the Buster is active and independently added to the Buster-local object. The overlay prevents double-counting for fields it supplies, but it also creates the replacement behavior above.
4. Non-Buster arms use the ordinary global player sheet and therefore receive bonuses from every equipped item.

This is the largest obstacle to comparing affixes consistently across weapon families.

## 2. Loot generation and scaling

### Generation formulas

For an item of level `L` and rarity multiplier `R`:

```text
base stat = roundStat(random(baseMin, baseMax) × R × (1 + L × 0.055))
affix     = roundStat(random(affixMin, affixMax) × R × (1 + L × 0.035))
```

Generation uses `max(1, level)`. Max HP, Energy, Attack, Armor, projectile count, pierce, and flat elemental damage are rounded to integers immediately. Other stats retain three decimal places. Integer rounding means narrow ranges can collapse to the same value and +1 projectile stays +1 on Standard items through level 10.

Legendary-template forced affixes are copied at their listed fixed values. They do **not** receive rarity or level scaling.

### Effective range multipliers at item levels 1, 5, and 10

Multiply every raw catalog range by the applicable number below before rounding.

| Rarity | Base L1 | Base L5 | Base L10 | Affix L1 | Affix L5 | Affix L10 | Random affixes |
|---|---:|---:|---:|---:|---:|---:|---:|
| Scrap | 0.971 | 1.173 | 1.426 | 0.952 | 1.081 | 1.242 | 0–1 |
| Standard | 1.055 | 1.275 | 1.550 | 1.035 | 1.175 | 1.350 | 1 |
| Tuned | 1.287 | 1.555 | 1.891 | 1.263 | 1.433 | 1.647 | 2–3 |
| Prototype | 1.635 | 1.976 | 2.403 | 1.604 | 1.821 | 2.093 | 3–4 |
| Ancient | 2.004 | 2.422 | 2.945 | 1.966 | 2.232 | 2.565 | 4–5 |
| Legendary | 2.374 | 2.869 | 3.488 | 2.329 | 2.644 | 3.038 | 5–6 |

Examples after runtime rounding:

| Roll | Level 1 | Level 5 | Level 10 |
|---|---:|---:|---:|
| Standard Buster Attack (`5–9`) | 5–9 | 6–11 | 8–14 |
| Tuned Alloy Chest Armor (`9–18`) | 12–23 | 14–28 | 17–34 |
| Prototype Reactor Chip Energy (`2–6`) | 3–10 | 4–12 | 5–14 |
| Standard Power affix (`2–9`) | 2–9 | 2–11 | 3–12 |
| Ancient Weak-Point affix (`12–46%`) | 24–90% | 27–103% | 31–118% |

The last row demonstrates the uncapped problem: a single high-level affix can add more than the entire base critical multiplier, while the label still implies a different mechanic.

### Drop chance and rarity probability

An enemy first rolls whether equipment drops:

```text
normal drop chance = 22% + min(enemy level × 1.2%, 18%)
elite drop chance  = 80% + min(enemy level × 1.2%, 18%)
```

| Enemy | Level 1 | Level 5 | Level 10 | Maximum |
|---|---:|---:|---:|---:|
| Normal | 23.2% | 28.0% | 34.0% | 40.0% |
| Elite | 81.2% | 86.0% | 92.0% | 98.0% |

When a drop succeeds, item type is uniform across all 38 types. Rarity weights are Scrap 48, Standard 30, Tuned 14, Prototype 6, Ancient 2, and Legendary 0.7. For enemy drops, every non-Scrap weight is multiplied by `eliteBonus + min(level × 0.04, 1.25)`, where `eliteBonus` is 1 normally and 2.8 for elites.

| Source | Scrap | Standard | Tuned | Prototype | Ancient | Legendary |
|---|---:|---:|---:|---:|---:|---:|
| Normal L1 | 46.69% | 30.35% | 14.16% | 6.07% | 2.02% | 0.71% |
| Normal L5 | 43.15% | 32.36% | 15.10% | 6.47% | 2.16% | 0.76% |
| Normal L10 | 39.42% | 34.49% | 16.09% | 6.90% | 2.30% | 0.80% |
| Elite L1 | 24.28% | 43.10% | 20.11% | 8.62% | 2.87% | 1.01% |
| Elite L5 | 23.29% | 43.67% | 20.38% | 8.73% | 2.91% | 1.02% |
| Elite L10 | 22.16% | 44.31% | 20.68% | 8.86% | 2.95% | 1.03% |

The modifier boosts all non-Scrap tiers equally, so it mostly converts Scrap into Standard rather than strongly targeting the top tiers.

Ten of 38 item types have a legendary template. On a Legendary roll of a matching type, the template is selected 70% of the time. Therefore only `10 / 38 × 70% = 18.42%` of generated Legendary items are expected to be named uniques, and each specific unique has a `1 / 38 × 70% = 1.84%` chance conditional on the item already being Legendary.

## 3. Current item catalog

All ranges below are the raw ranges in `ITEM_TYPES`, before level and rarity multiplication.

### Arm weapons

| Item | Raw base stats | Runtime effectiveness |
|---|---|---|
| Buster Arm | Attack 5–9; Energy 6–10; Range 6.2–7.4; Rapid 8–18% | Uses its separate Buster sheet. Base shot cooldown is `0.24 / (1 + Rapid)`, then CDR. Energy determines output burst capacity rather than normal shot cost. |
| Laser Beam Blade | Attack 8–14; Energy 3–6; Range 2.1–2.8; Rapid 4–14%; Area 12–24% | Fixed 0.86s animation dominates cadence. Effective arc starts at 2.25 and gains only 0.24 per global Range above 6.2, capped at 4.4. Area multiplies damage and widens the arc. |
| Drill Arm | Attack 5–9; Energy 7–12; Range 1.45–1.85; Rapid 16–32%; Armor Break 6–14% | Contact range is fixed at 1.05, so its base Range roll does not improve drilling. Damage ticks every 0.12s with a 0.12 profile multiplier and a per-tick enemy cap of 3; launched drill uses Range bonuses. Strong innate +28% Armor Break and 10 armor pierce. |
| Lift Arm | Energy 5–8; Range 1.25–1.65; Rapid 4–10% | Main lift range is fixed at 1.55 and profile damage multiplier is zero. Most offensive affixes can roll but offer no normal lift damage benefit. |
| Machine Gun Arm | Attack 2–5; Energy 12–20; Range 5.5–6.8; Rapid 30–52% | 0.68 damage multiplier and 0.56 cooldown multiplier; Rapid improves cadence and output efficiency. Low output increases spread and slows cadence. |
| Cannon Arm | Attack 12–20; Energy 1–3; Range 5–6.6; Rapid 1–8%; Area 18–36% | 1.45 direct multiplier, 1.75 base explosion radius, plus a 62%-damage explosion on contact. Costs 2 Energy and drains full output. Area boosts both damage and radius. |
| Mine Layer Arm | Attack 10–18; Energy 3–6; Range 4.8–6.4; Rapid 2–8%; Area 12–28%; Armor Break 3–8% | Places up to four mines, plus up to two from projectile count. 1.28 damage multiplier, 1.95 base radius, +8% profile Armor Break. |
| Missile Arm | Attack 9–16; Energy 3–6; Range 6–8; Rapid 4–12%; Explosive Finish 4–10% | Homing range has a 9.5 minimum. Normal shot uses 1.22 damage; salvo fires three 0.72-damage missiles. Lock-On Speed shortens lock time. Base Explosive Finish is a global on-kill proc, not missile impact behavior. |
| Grenade Arm | Attack 10–17; Energy 2–5; Range 4.4–6.2; Rapid 3–10%; Area 16–32% | 1.18 damage multiplier, arcing projectile, 1.55 base radius, five-cluster alternate. Area increases roll damage and explosion sizes. |
| Rail Buster Arm | Attack 8–14; Energy 3–6; Range 7.6–9.5; Rapid 2–10%; Pierce 2–4; Armor Break 4–10% | Instant rail line; effective range adds 2.4. Hits `round(Pierce + 3 + 1)` targets, ignores 16 armor, and adds 8% Armor Break. |
| Scatter Buster Arm | Attack 3–7; Energy 6–11; Range 4.1–5.6; Rapid 12–24%; Projectiles 1–2 | Fires `round(Projectiles + 4)` pellets, each at 0.64 damage. Extra-projectile rolls are highly effective here. |
| Homing Seeker Arm | Attack 6–11; Energy 5–9; Range 6.5–8.4; Rapid 6–16%; Lock-On 8–20% | Free-homing projectiles with 0.94 damage and a small 0.75 explosion. Its profile does not use lock-time acquisition, so the base Lock-On stat has little/no direct value for normal seeker fire. |
| Shining Laser | Attack 8–13; Energy 4–8; Range 8–10; Rapid 5–14%; Pierce 1–2 | Held 0.1s ticks, 0.48 profile damage, heat ramp up to 1.65x, Range +3.5, 24 armor pierce. Listed Pierce is not used by the beam trace. Rapid mainly affects output efficiency, not the fixed laser tick interval. |
| Flame Arm | Attack 4–8; Energy 6–10; Range 3.4–4.6; Rapid 10–20%; Thermal 3–8 | Held cone with 0.9 range multiplier, burn, and fire zones. Flat Thermal is added to every damage roll before profile scaling. |
| Ice Sprayer Arm | Attack 3–7; Energy 7–12; Range 3.6–5; Rapid 10–22%; Cryo 3–8 | Held cone with chill/freeze buildup. Flat Cryo adds damage; lower damage profile trades for higher freeze buildup. |
| Shock Coil Arm | Attack 4–8; Energy 6–10; Range 4.2–5.8; Rapid 10–22%; Chain Shock 6–16% | Chain attack with 0.9 damage, four profile targets, and a built-in 70% chain chance. The global Chain Shock stat can also proc a separate 42%-damage chain, creating overlapping proc paths. |
| Shield Arm | Armor 6–13; HP 8–18; Stagger Resistance 5–12% | Armor and HP work globally. Guard reduction is 56% plus `1.2% × shield Armor`, capped at 78%; parry reduction starts at 86% and caps at 96%. Stagger Resistance only adds up to 10 percentage points to parry reduction. |

### Buster parts

| Item | Raw base stats | Runtime effectiveness |
|---|---|---|
| Power Raiser | Attack 2–7 | Direct Buster-local damage; high value and predictable. |
| Range Booster | Range 0.6–1.8; Projectile Speed 0.2–0.5 | Both apply to Buster projectiles. Projectile Speed is additive to the 9.5 profile speed. |
| Rapid Fire Unit | Rapid 12–34% | Reduces Buster cooldown through `0.24 / (1 + Rapid)`; displayed as a percentage bonus. |
| Energy Battery | Energy 3–8; Recharge 5–14% | Energy increases Buster output burst capacity by one shot per 3 Energy; Recharge shortens reload, but Buster output is a separate limiting resource. |
| Sniper Scope | Range 1–2.4; Critical Chance 3–8% | Range applies. Its local Critical Chance can replace the global total rather than add to it. No separate sniper-shot mechanic is present. |
| Heat Sink Core | CDR 4–12%; Recharge 6–16% | Both work on the Buster-local sheet. CDR affects shot cooldown and reload; Recharge affects reload only. |

### Armor and sensor gear

| Item | Raw base stats | Runtime effectiveness |
|---|---|---|
| Kevlar Jacket | Armor 6–13 | Fully functional mitigation. |
| Alloy Chest Plate | Armor 9–18; HP 8–18 | Fully functional defense; HP and Armor multiply each other's effective-health value. |
| Refractor-Lined Armor | Armor 8–16; Energy 2–5; Recharge 3–10% | Defensive stats work. Energy/Recharge benefit non-Buster arms but are ignored by Buster-local replacement. |
| Utility Helmet | Armor 3–8; HP 4–12 | Fully functional defense. |
| Lock-On Visor | Armor 2–6; Lock-On 8–22%; Critical Chance 2–6% | Armor and crit work. Lock-On only matters to lock-acquisition paths, principally Missile Arm. |
| Refractor Scanner | Armor 2–5; Pickup Radius 0.12–0.35; Elite Detection 10–25% | Armor and pickup radius work. Elite Detection is never read. |

### Mobility gear

| Item | Raw base stats | Runtime effectiveness |
|---|---|---|
| Servo Boots | Movement 0.18–0.45; Knockback Resistance 4–12% | Movement works additively. Knockback Resistance is never read. |
| Jet Skates | Movement 0.24–0.55; Dash Recovery 6–18% | Movement works. Dodge duration/distance and recovery are constants; Dash Recovery is never read. |
| Magnetic Soles | Movement 0.12–0.32; Pickup Radius 0.15–0.45 | Both stats work. |

### Modules, cartridge, and cores

| Item | Raw base stats | Runtime effectiveness |
|---|---|---|
| Reactor Chip | Energy 2–6; Recharge 5–15% | Strong for non-Buster sustained use; both fields are ignored by the Buster-local replacement. |
| Capacitor Module | Rapid 6–18%; Energy 1–4 | Strong for non-Buster cadence/output. Both fields are ignored by Buster-local replacement. |
| Targeting Chip | Critical Chance 2–7%; Lock-On 6–18% | Crit is broadly useful; Lock-On is contextual. A local Buster crit roll can overwrite the combined value. |
| Energy Cartridge | Energy 3–7 | Functional for non-Buster arms; ignored by Buster-local Energy. |
| Refractor Core | Energy 3–8; Critical Damage +0.10–0.24; Pickup 0.10–0.25 | Energy is ignored by Buster-local Energy. Critical Damage adds to the 1.55 base globally, despite being formatted as a percentage and labeled Weak-Point Damage. |
| Adapter Plug | CDR 4–12%; Swap Speed 8–22% | Swap Speed reduces 0.34s swap delay to a 0.12s floor, with the stat clamped at 65%. CDR works for non-Buster cooldown/reload but is overwritten on Buster. |

## 4. Affix catalog and effectiveness

The level benchmark columns show **Standard-rarity** values after generation rounding. Other rarities use the multiplier table in section 2.

Classification meanings:

- **Functional:** runtime behavior matches the broad claim.
- **Contextual:** works, but only on compatible weapon families or circumstances.
- **Partial:** some intended applications work, while aggregation or weapon rules discard part of the value.
- **Misleading:** it works, but the label materially misstates what it does.
- **Inert:** generated and scored, but has no runtime consumer.

| Affix | Eligible item slots | Raw range | Std L1 / L5 / L10 | Class | Actual effectiveness |
|---|---|---:|---:|---|---|
| Power | weapon, hands, module, core | 2–9 Attack | 2–9 / 2–11 / 3–12 | Partial | Adds global damage for non-Buster arms. Module/core Power is ignored by Buster-local Attack. |
| Energy | weapon, hands, chest, module, core | 2–8 | 2–8 / 2–9 / 3–11 | Partial | More shots/use time for non-Buster arms; Buster only reads Buster/Buster-upgrade Energy. Buster gains one output shot per 3 Energy. |
| Rapid | weapon, hands, feet, module, core | 8–32% | 8–33% / 9–38% / 11–43% | Partial | Non-Buster cooldown is roughly inverse-Rapid and Rapid improves output efficiency. Fixed animation/tick intervals limit some arms. Global rolls are ignored by Buster. |
| Range | weapon, hands, head, module, core | 0.45–1.8 | 0.47–1.86 / 0.53–2.12 / 0.61–2.43 | Contextual | Full on normal projectiles; altered or ineffective on Sword, Drill contact, Lift, Missile minimum range, and some special traces. Global rolls are ignored by Buster. |
| Stabilizer | weapon, hands, head, module, core | 3–13% crit | 3.1–13.5% / 3.5–15.3% / 4.1–17.6% | Partial | Real random crit chance, capped at 85%. Buster-local presence can replace rather than add to global crit. |
| Weak-Point | weapon, head, module, core | 12–46% | 12.4–47.6% / 14.1–54.1% / 16.2–62.1% | Misleading | Adds to random critical multiplier. It does not modify geometric weak-point bonuses. Buster-local presence can replace the 1.55 global base. |
| Servo | feet, module, core | 0.15–0.55 speed | 0.16–0.57 / 0.18–0.65 / 0.20–0.74 | Functional | Additive world movement speed; run multiplies the final tuned speed. |
| Reinforced | head, chest, offhand, feet, module, core | 8–35 HP | 8–36 / 9–41 / 11–47 | Functional | Adds Max HP and preserves current health percentage when recalculated. |
| Alloy | head, chest, hands, feet, offhand | 3–18 Armor | 3–19 / 4–21 / 4–24 | Functional | Player damage multiplier is `100 / (100 + Armor)` with no cap. Also improves Shield guard when rolled on the shield. |
| Magnetic | feet, head, module, core | 0.18–0.75 radius | 0.19–0.78 / 0.21–0.88 / 0.24–1.01 | Functional | Directly expands pickup collection radius. “Digger's Luck” wording does not affect drop quality. |
| Burst | weapon, hands, core | +1 projectile | +1 / +1 / +1 | Contextual | Strong on projectile-spawning attacks and Scatter; increases Mine active cap by at most two. No value on melee, beam, lift, or many special attacks. |
| Piercing | weapon, hands, module, core | +1–2 pierce | 1–2 / 1–2 / 1–3 | Contextual | Extends projectile/rail multi-hit count. No value for explosions, melee, cone, chain, mine, or the Shining Laser beam trace. |
| Wide Arc | weapon, hands, module, core | 8–28% | 8.3–29.0% / 9.4–32.9% / 10.8–37.8% | Misleading | Multiplies all rolled player damage, not only area damage, and also expands selected arcs/radii. This is a general multiplicative damage affix. |
| Thermal | weapon, module, core | 2–10 damage | 2–10 / 2–12 / 3–14 | Partial | Flat damage is added to every hit and participates in profile/Area/crit multiplication. It can select fire as the active status element, but multiple element stats all add damage while only one status wins priority. |
| Cryo | weapon, module, core | 2–8 damage | 2–8 / 2–9 / 3–11 | Partial | Same flat-damage behavior; can select chill/freeze unless Thermal has priority. |
| Recovery | weapon, chest, module, core | 2–8% | 2.1–8.3% / 2.4–9.4% / 2.7–10.8% | Functional | Heals for a percentage of actual post-mitigation damage dealt. Status ticks are excluded. No cap. |
| Explosive | weapon, module, core | 4–16% | 4.1–16.6% / 4.7–18.8% / 5.4–21.6% | Functional | On player-attributed kill, deals `1.4 × global Attack` in a 1.9 radius. It is not tied to explosive arms and has no explicit chance cap. |
| Shock | weapon, module, core | 4–14% | 4.1–14.5% / 4.7–16.5% / 5.4–18.9% | Functional | On non-status player hit, can deal 42% of damage to the nearest enemy within 4.8. Any positive value also selects shock visuals/status if no flat element has priority. No explicit chance cap. |
| Cooling | weapon, hands, chest, feet, module, core | 4–16% CDR | 4.1–16.6% / 4.7–18.8% / 5.4–21.6% | Partial | Multiplies attack cooldown by `(1 - CDR)` and partially shortens reload. Capped at 75%. Global CDR is overwritten by Buster-local CDR, often zero. |
| Recharge | weapon, hands, chest, module, core | 5–20% | 5.2–20.7% / 5.9–23.5% / 6.8–27.0% | Misleading | Does not regenerate Energy over time. It only reduces reload duration, with contribution capped once the stat reaches 0.9. Global value is overwritten by Buster-local value. |
| Lock-On | weapon, hands, head, module | 6–22% | 6.2–22.8% / 7.0–25.9% / 8.1–29.7% | Contextual | Missile lock progress is multiplied by `1 + LockOnSpeed`. Most arms do not use lock progress; homing alone does not guarantee value. |
| Corrosive | weapon, module, core | 2–8 damage | 2–8 / 2–9 / 3–11 | Partial | Flat damage is always added; corrosion status applies only when it wins element priority, then deals 18% of the hit per second and reduces armor. |
| Armor Break | weapon, hands, module, core | 5–18% | 5.2–18.6% / 5.9–21.1% / 6.8–24.3% | Functional | Chance per eligible hit, plus profile bonus; capped globally at 85%. Applies 3.2s armor reduction of `clamp(0.8 × dealt, 8, 34)`. |
| Dash | feet, module, core | 6–22% | 6.2–22.8% / 7.0–25.9% / 8.1–29.7% | Inert | Stored and displayed but never read by dodge movement, duration, invulnerability, or recovery. |
| Burn-Resistant | head, chest, feet, module, core | 8–28% | 8.3–29.0% / 9.4–32.9% / 10.8–37.8% | Inert | No player burn-resistance calculation reads this stat. |
| Shock-Resistant | head, chest, feet, module, core | 8–28% | 8.3–29.0% / 9.4–32.9% / 10.8–37.8% | Inert | No player shock-resistance calculation reads this stat. |

### Non-affix base stats with limited or no effect

| Stat | Source | Status |
|---|---|---|
| Knockback Resistance | Servo Boots | Inert; generated, displayed, and scored but never consumed. |
| Elite Detection | Refractor Scanner | Inert; generated, displayed, and scored but never consumed. |
| Stagger Resistance | Shield Arm | Partial; it does not generally resist stagger. It only contributes `clamp(stat × 0.18, 0, 0.10)` to parry damage reduction. |
| Projectile Speed | Range Booster | Functional on spawned Buster/projectile shots; irrelevant to beams, rails, melee, cones, and other non-projectile traces. |
| Swap Speed | Adapter Plug | Functional; `max(0.12, 0.34 × (1 - clamp(SwapSpeed, 0, 0.65)))`. |

## 5. Effective runtime formulas

### Damage and criticals

The common roll used by most player attacks is:

```text
elemental = Thermal + Cryo + Corrosion
raw       = Attack + elemental
rolled    = raw × random(0.90, 1.12)
areaAmp   = rolled × (1 + AreaOutput)
profile   = areaAmp × weaponDamageMultiplier
final     = critical ? profile × CriticalDamage : profile
```

Expected random variance is 1.01, not exactly 1.00. Expected crit multiplier is approximately:

```text
1 + CriticalChance × (CriticalDamage - 1)
```

At the baseline 8% chance and 1.55x multiplier this is only 1.044x expected damage. A +10% critical-chance roll adds about 5.5% expected damage at baseline multiplier, while flat Attack and Area Output are usually much stronger.

Geometric weak-point hits are identified separately by enemy collision code. `criticalDamage` does not check `weakPointHit`, so “Weak-Point Damage” is a naming error.

### Enemy armor, Armor Break, and player armor

Enemy hit damage is:

```text
effectiveArmor = max(0, enemyArmor - corrosionReduction - armorBreakReduction - armorPierce)
damageTaken    = adjustedDamage × 100 / (100 + effectiveArmor)
```

Corrosion and Armor Break reductions stack additively. Armor pierce is supplied by the arm profile, not by the `projectilePierce` stat.

Player incoming damage uses the same hyperbolic shape without pierce:

```text
damageTaken = guardedDamage × 100 / (100 + playerArmor)
```

Each Armor point adds 1% of base HP to effective HP against ordinary damage. With 160 HP and 4 Armor, baseline effective HP is 166.4. HP and Armor therefore multiply each other's value; there is no Armor cap.

### Rapid and cooldown

For non-Buster arms:

```text
cooldown = max(0.08, (1 / max(0.25, Rapid)) × profileCooldownMultiplier × (1 - CDR))
```

For the Buster:

```text
cooldown = max(0.075, 0.24 / (1 + BusterRapid) × (1 - BusterCDR))
```

These two definitions make an identically displayed Rapid roll non-comparable between Buster and non-Buster arms. Many profiles also have fixed animation durations or fixed tick intervals, so nominal cooldown is not always realized as proportional DPS.

Rapid also changes weapon output through `sqrt(currentRapid / baseRapid)`, clamped to 0.65–1.75. It increases output recovery, reduces output cost/drain, and lowers output needed to fire. This secondary benefit is significant and not visible in item descriptions.

### Energy, output, and reload

Non-Buster arms spend profile-specific Energy and a separate 0–1 weapon-output resource. Output begins recovering after a hard-coded 0.5s delay; the per-profile `outputRecoveryDelay` values are currently not used by `_getOutputRecoveryDelay()`.

Buster output shot capacity is:

```text
capacity = max(1, 3 + (BusterEnergy - 6) / 3)
output cost per shot = 1 / capacity
```

The capacity is not rounded, so intermediate Energy creates fractional output costs rather than a clearly discrete magazine.

Reload duration is:

```text
max(0.42, (1.35 - min(EnergyRecharge, 0.9) × 0.36) × (1 - CDR × 0.45))
```

“Energy Recharge” therefore means reload-speed contribution, not regeneration. Its maximum standalone improvement is 0.324s before the 0.42s floor.

### Range exceptions

- Ordinary projectiles: global Range, with some profiles adding a fixed bonus.
- Buster: Buster-local Range.
- Sword: `min(4.4, 2.25 + max(0, globalRange - 6.2) × 0.24)`.
- Drill contact: fixed 1.05; global Range only improves the launched drill from a 5.3 base.
- Laser: Range +3.5.
- Rail: Range +2.4.
- Missile: at least 9.5, otherwise Range +1.8.
- Grenade/chain: Range +0.8.
- Cone: Range multiplied by the profile's cone multiplier and current output quality.
- Lift: fixed 1.55.

This makes Range impossible to value generically without an applicability tag for each arm mode.

### Area Output and explosions

Area Output first multiplies the common damage roll even for single-target attacks. It then has additional geometric effects:

- Grenade radius: `base + Area × 0.65`.
- Mine radius: `base + Area × 0.8`.
- Sword arc angle: grows with Area.
- Fire-zone radius: grows with Area.
- Cluster explosion and several preview/secondary radii: smaller Area coefficients.

Projectile impact explosions deal another 62% of the already Area-amplified projectile damage. Expired explosive projectiles use 72%. Area thus improves both the source damage and coverage, and direct-hit explosives can damage the same target through both direct and explosion paths.

### Elements and statuses

All flat Thermal, Cryo, and Corrosion values are summed into damage regardless of which status is applied. The active element is selected in priority order: profile-forced element, then Thermal, then Cryo, then Corrosion; Shock is selected from positive Chain Shock chance only if none of those wins.

- Fire: 2.8s burn at 24% of dealt damage per second, minimum 1.1 DPS.
- Ice: 2.5s chill, 38% slow, buildup-dependent 0.95s freeze.
- Shock: 0.28s interrupt and an additional chain opportunity when allowed by hit metadata.
- Corrosion: 3.6s at 18% of dealt damage per second, minimum 0.8 DPS, plus armor reduction `clamp(0.55 × dealt, 5, 22)`.

Because every flat element contributes to raw damage but only one status is selected, multi-element gear behaves as additive generic damage with a priority-selected skin/status rather than a true multi-element build.

### Other effects

- Life Steal heals from actual dealt damage after enemy mitigation; status ticks cannot trigger it.
- Explosive Finish is a global kill proc using global Attack, not the killing hit's damage or weapon stats.
- Chain Shock is a global per-hit proc to one nearest target. Shock Coil can also request its own profile chain, so overlapping chains are possible.
- Lock-On Speed multiplies lock progress by `1 + stat`; it has no global cap.
- Movement Speed is flat world-units-per-second and then multiplied by run/slow/guard/action factors.
- Pickup Radius directly controls pickup collection distance.
- Shield Armor improves both ordinary armor mitigation and the shield-specific guard calculation.
- Swap Speed has a 65% stat cap and a 0.12s absolute swap-delay floor.

## 6. Power-score reliability

`Item.getPowerScore()` is a static weighted sum. It does not know the equipped arm, whether a stat is compatible, whether a cap is reached, or whether a runtime consumer exists.

Examples of incorrect valuation:

- Dash Recovery has weight 24 despite being inert.
- Burn and Shock Resistance each have weight 12 despite being inert.
- Knockback Resistance has weight 16 and Elite Detection weight 10 despite being inert.
- Stagger Resistance is scored as general defense even though it only makes a small parry-reduction contribution.
- Projectile count and pierce receive substantial scores on items/modes that cannot use them.
- Area Output's weight does not reflect that it is a general multiplicative damage stat plus geometric scaling.
- Buster-ignored module/core stats retain their full score.
- Caps and integer breakpoints are ignored.

Garage optimization and comparison use this score, so they can recommend a mathematically weaker or completely inert item.

## 7. Legendary item audit

Every named unique below has working base stats and forced affixes. None of the `uniqueEffect` strings has a runtime implementation or identifier check; `uniqueEffect` is only added to display lines.

| Legendary template | Fixed forced affixes | Described unique effect | Runtime status |
|---|---|---|---|
| Ancient Omni Buster | +9 Attack, +8 Energy, +22% Rapid | Inherit previous arm element after swap | Tooltip-only |
| Refractor Sword Arm | +12 Attack, +24% Area | Timed swings release energy wave | Tooltip-only |
| Kattelox Drill Arm | +24% Armor Break, +6 Energy | Sustained drill improves break/salvage | Tooltip-only; numeric Armor Break works |
| Bonne-Style Cannon Arm | +22% Explosive Finish, +14 Attack | Elite hits split into bomblets | Tooltip-only; generic kill explosion works |
| Shining Refractor Laser | +3 Pierce, +2.2 Range | Bonus versus broken armor | Tooltip-only; Pierce is ineffective on beam trace |
| Junker's Auto Battery | +10 Energy, +18% Recharge | Empty reload grants Rapid | Tooltip-only |
| Ancient Kevlar Frame | +22 Armor, +36 HP | Survive lethal damage by consuming Energy | Tooltip-only |
| Prototype Lock-On Visor | +30% Lock-On, +12% crit | Marked-target bonus damage | Tooltip-only |
| Jet Skates DX | +0.72 Movement, +26% Dash Recovery | Post-fire dash damage trail | Tooltip-only; Dash Recovery is inert |
| Thermal Bloom Flame Arm | +12 Thermal, +18% Explosive Finish | Burning enemies create flame burst | Tooltip-only; generic kill explosion works |

These templates are especially misleading because the orange rarity and explicit “Unique:” line imply implemented behavior.

## 8. Decision options

### Option A: minimally repair the existing system

Preserve item generation, weapon profiles, rarity tiers, and additive equipment, but make the current contract honest and testable.

1. Remove inert stats from generation immediately or implement them before they can roll. Set their power-score weight to zero until functional.
2. Replace the Buster overlay with explicit additive sources: character base, global gear, active weapon local stats, Buster upgrades, and temporary effects. Define which source each stat accepts.
3. Rename Critical Damage/Weak-Point Damage and Energy Recharge to match runtime behavior, or change runtime behavior to match the names.
4. Restrict affix pools by item/weapon capability rather than only broad equipment slot. Do not roll projectile count on melee/lift/beam items or resistances without incoming status systems.
5. Split Area Output into a true damage stat and an area/radius stat, or remove its universal damage multiplier.
6. Implement legendary effects with stable effect IDs, or remove the unique descriptions and treat the items as named fixed-affix rolls.
7. Replace static power score with capability-aware comparison that respects caps, current weapon, expected damage, effective HP, and dead/contextual stats.
8. Add stat-contract tests covering generation, aggregation, each runtime consumer, caps, and legendary activation.

**Advantages:** retains substantial existing content and the differentiated arm profiles; lower migration cost; easiest path to a trustworthy prototype.

**Risks:** the model remains a large flat additive stat bag. Weapon exceptions will continue to require special valuation rules, and uncapped linear scaling will still need a progression target or item-level cap.

### Option B: overhaul the item-stat layer

Retain weapon identity and visuals but replace generic stat aggregation with explicit domains.

1. Separate character stats, global equipment stats, active-weapon stats, weapon resources, and conditional effects into typed structures.
2. Give each weapon mode declared capabilities such as `projectile`, `beam`, `meleeArc`, `explosion`, `lockOn`, `status`, and `guard`; use these tags to construct legal affix pools.
3. Define stacking categories and order: flat base, local weapon flat, global additive percentage, conditional multiplier, caps, and final conversions.
4. Make Energy/Output models weapon-local rather than sharing names for different mechanics. Expose magazine/burst, drain, reload, cooling, and output recovery directly.
5. Replace unbounded level multiplication with bounded tiers, upgrade steps, budgets, or curves tied to an intended progression horizon.
6. Value affixes in measurable outcomes such as single-target DPS, burst duration, reload-adjusted DPS, effective HP, mobility, or control uptime.
7. Represent legendary behavior as data-backed effect IDs with tests, not free text.

**Advantages:** clear ownership, predictable balance, legal affixes by construction, and easier automated comparison.

**Risks:** requires item migration, UI changes, new generation rules, and rebalancing all 38 item types and 26 affixes. The current weapon-profile constants still need reconciliation with the new stat domains.

## 9. Suggested acceptance tests for either path

- Every generated stat must have at least one tested runtime consumer or be marked display-only and excluded from power.
- For every weapon mode, a test should state which global and local stats affect damage, cadence, range, resources, projectile count, pierce, area, and statuses.
- Buster modules/cores and temporary buffs must either add by contract or be explicitly rejected by type; no silent replacement.
- Critical Damage and geometric weak-point damage must have distinct names and tests.
- Level 1/5/10 generation snapshots should cover integer rounding, percentage precision, rarity multipliers, forced legendary affixes, and affix uniqueness.
- Optimization must never prefer an item solely because of an inert or incompatible stat.
- Each legendary description must have a triggered behavior test before appearing in the UI.

## Bottom line

The current system is not safe to balance from displayed power values, but it is not devoid of reusable structure. The weapon-profile layer is already rich enough to preserve under either option. A minimal repair is viable if the near-term goal is a trustworthy prototype and the team is willing to formalize applicability and stacking now. A full overhaul is justified if long progression, buildcraft, automated item comparison, or many more weapon families are core goals, because the present flat-stat model and Buster exception path will become increasingly expensive to reason about.
