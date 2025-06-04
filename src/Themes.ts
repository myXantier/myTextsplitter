
export interface myTheme {
    title: string;
    isDark: boolean;
    getNextTheme(): myTheme;

    colors: {
        // Default Colors
        primary: string,
        secundary: string,
        accentColor: string,
        accentColor_dark: string,
        transparent: string,
        // Background Levels
        background: string,
        background_1: string,
        background_2: string,
        background_3: string,
        background_4: string,
        background_5: string,
        background_6: string,
        // Buttons Colors
        buttonColor: string,
        buttonBgColor: string,
        buttonBgHover: string,
        buttonBgPressed: string,
        // Input Colors
        inputColor: string,
        inputColorFocus: string,
        inputBgColor: string,
        inputBgHover: string,
        inputBgFocus: string,
        inputBorder: string,
        inputErrorBg: string,
        inputErrorBorder: string,
        inputCorrectBorder: string,
        // Link Colors
        linkColor: string,
        linkHover: string,
        linkActive: string,
        // Text Colors
        color: string,
        color_1: string,
        color_2: string,
        // App Colors
        appColorGreen: string,
        appColorRed: string,
        appColorYellow: string,
        appColorOrange: string,
        appColorPink: string,
        appColorPink_1: string,
        appBorderColor: string,
        // Icon Color
        appIconColor: string,
    },

    settings: {
        // Setings - Just for Linux
        appBorderMargin: string,
        appBorderRadius: string,
    }
}

export const light: myTheme = {
    title: 'light',
    isDark: false,
    getNextTheme() { return dark; },

    colors: {
        // Default Colors
        primary: '#1B1D23',
        secundary: '#454545',
        accentColor: '#62AEEF',
        accentColor_dark: '#4E8BBF', // Abgedunkelte Variante für Hover-Effekte
        transparent: 'transparent',

        // Background Levels
        background: '#EDEDED',  // Haupt-Hintergrundfarbe (sanfter als #c1c1c1)
        background_1: '#E3E3E3', // Dunkler Bereich für Kontraste
        background_2: '#DADADA', // Sanfter Kontrast
        background_3: '#D6D6D6', // Noch ein Level heller
        background_4: '#D1D1D1', // Sekundäre Bereiche
        background_5: '#CBCBCB', // Panels und Boxen
        background_6: '#C6C6C6', // Extra heller Bereich (z.B. Header/Footer)

        // Buttons Colors
        buttonColor: '#454545',
        buttonBgColor: '#3F719B',
        buttonBgHover: '#62AEEF',
        buttonBgPressed: '#E06B74',

        // Input Colors
        inputColor: '#333',
        inputColorFocus: '#000',
        inputBgColor: '#F0F0F0',
        inputBgHover: '#DADADA',
        inputBgFocus: '#BEBEBE',
        inputBorder: '#C1C1C1',
        inputErrorBg: '#F4E1E1',
        inputErrorBorder: '#E06B74',
        inputCorrectBorder: '#98C379',

        // Link Colors
        linkColor: '#3F719B',
        linkHover: '#62AEEF',
        linkActive: '#E06B74',

        // Text Colors
        color: '#333',
        color_1: '#454545',
        color_2: '#808080',

        // App Colors
        appColorGreen: '#98C379',
        appColorRed: '#E06B74',
        appColorYellow: '#E5C07B',
        appColorOrange: '#D88D19',
        appColorPink: '#FF008C',
        appColorPink_1: '#C678DD',
        appBorderColor: '#D6D6D6',

        // Icon Color
        appIconColor: '#333',
    },

    settings: {
        appBorderMargin: '5px',
        appBorderRadius: '10px',
    }
};


export const dark: myTheme = {
    title: 'dark',
    isDark: true,
    getNextTheme() { return light; },

    colors: {
        // Default Colors
        primary: '#1B1D23',
        secundary: '#98C379',
        accentColor: '#62AEEF',
        accentColor_dark: '#589cd7', // Abgedunkelte Variante für Hover-Effekte
        transparent: 'transparent',

        // Background Levels
        background: '#1B1D23',  // Haupt-Hintergrundfarbe
        background_1: '#1E2027', // Dunkler Bereich für Kontraste
        background_2: '#242730', // Sanfter Kontrast
        background_3: '#272C36', // Noch ein Level heller
        background_4: '#2D313C', // Sekundäre Bereiche
        background_5: '#353B48', // Panels und Boxen
        background_6: '#404756', // Extra heller Bereich (z.B. Header/Footer)

        // Buttons Colors
        buttonColor: '#D7DCE4',
        buttonBgColor: '#3F719B',
        buttonBgHover: '#62AEEF',
        buttonBgPressed: '#98C379',

        // Input Colors
        inputColor: '#B1B7C3',
        inputColorFocus: '#D7DCE4',
        inputBgColor: '#1B1D23',
        inputBgHover: '#1E2027',
        inputBgFocus: '#252A32',
        inputBorder: '#1B1D23',
        inputErrorBg: '#2C313C',
        inputErrorBorder: '#E06B74',
        inputCorrectBorder: '#98C379',

        // Link Colors
        linkColor: '#3F719B',
        linkHover: '#62AEEF',
        linkActive: '#E06B74',

        // Text Colors
        color: '#B1B7C3',
        color_1: '#969DAB',
        color_2: '#727B8C',

        // App Colors
        appColorGreen: '#98C379',
        appColorRed: '#E06B74',
        appColorYellow: '#E5C07B',
        appColorOrange: '#D48100',
        appColorPink: '#FF008C',
        appColorPink_1: '#C678DD',
        appBorderColor: '#282C33',

        // Icon Color
        appIconColor: '#B1B7C3',
    },

    settings: {
        appBorderMargin: '5px',
        appBorderRadius: '10px',
    }
};