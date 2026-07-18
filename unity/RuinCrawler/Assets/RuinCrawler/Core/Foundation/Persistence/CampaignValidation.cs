using System;

namespace RuinCrawler.Core.Foundation
{
    internal static class CampaignValidation
    {
        public static string RequireContextId(string value, string parameterName)
        {
            if (string.IsNullOrWhiteSpace(value))
            {
                throw new ArgumentException("A save context id is required.", parameterName);
            }

            string trimmed = value.Trim();
            if (trimmed.Length > 160)
            {
                throw new ArgumentOutOfRangeException(parameterName, trimmed.Length, "Save context id cannot exceed 160 characters.");
            }

            for (int index = 0; index < trimmed.Length; index += 1)
            {
                char character = trimmed[index];
                bool valid = (character >= 'a' && character <= 'z')
                    || (character >= 'A' && character <= 'Z')
                    || (character >= '0' && character <= '9')
                    || character == '.'
                    || character == '_'
                    || character == ':'
                    || character == '-';
                if (!valid)
                {
                    throw new ArgumentException(
                        "Save context id may contain only letters, numbers, period, underscore, colon, and hyphen.",
                        parameterName);
                }
            }

            return trimmed;
        }

        public static string RequireText(string value, string parameterName)
        {
            if (string.IsNullOrWhiteSpace(value))
            {
                throw new ArgumentException("A non-empty value is required.", parameterName);
            }

            return value.Trim();
        }

        public static void RequireState<TState>(TState state, string parameterName)
        {
            if (ReferenceEquals(state, null))
            {
                throw new ArgumentNullException(parameterName);
            }
        }
    }
}
