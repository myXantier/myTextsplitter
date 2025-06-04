type TextCase = 'PascalCase' | 'CamelCase' | 'FlatCase' | 'SnakeCase' | 'KebabCase' | 'TitleCase' | 'TitleCasePlus';

/**
 * const input = "exampleText_for-conversion";
 * - PascalCase => ExampleTextForConversion
 * - CamelCase => exampleTextForConversion
 * - FlatCase => exampletextforconversion
 * - SnakeCase => example_text_for_conversion
 * - KebabCase => example-text-for-conversion
 * - TitleCase => Example Text For Conversion
 * - TitleCasePlus => Example Text for conversion
 */
export function convertTextCase(input: string | string[], caseType: TextCase): string {
  // Helper to split the string into words
  const splitIntoWords = (text: string): string[] => {
    return (
      text
        //   .replace(/([a-z])([A-Z])/g, '$1 $2') // Handle camelCase or PascalCase
        //   .replace(/[-_]/g, ' ') // Handle kebab-case and snake_case
        .replace(/(?<=[a-z])(?=[A-Z])|[-_]/g, ' ') // Handle camelCase, PascalCase, kebab-case and snake_case
        .toLowerCase()
        .split(/\s+/)
    ); // Split by spaces or combined formats
  };

  const splitIntoOriginalCaseWords = (text: string): string[] => {
    return text
      .replace(/(?<=[a-z])(?=[A-Z])|[-_]/g, ' ') // Handle camelCase, PascalCase, kebab-case and snake_case
      .split(/\s+/); // Split by spaces or combined formats
  };

  // Get words array
  const words = Array.isArray(input)
    ? input
    : caseType === 'TitleCasePlus'
    ? splitIntoOriginalCaseWords(input)
    : splitIntoWords(input);

  // Format based on the specified case type
  switch (caseType) {
    case 'PascalCase':
      return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join('');

    case 'CamelCase':
      return words.map((word, index) => (index === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1))).join('');

    case 'FlatCase':
      return words.join('');

    case 'SnakeCase':
      return words.join('_');

    case 'KebabCase':
      return words.join('-');

    case 'TitleCase':
      return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');

    case 'TitleCasePlus':
      const result = words.join(' ');
    return result.charAt(0).toUpperCase() + result.slice(1);

    default:
      throw new Error(`Unsupported case type: ${caseType}`);
  }
}
