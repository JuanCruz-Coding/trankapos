/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Paleta brandbook TrankaSoft (compartida con la landing)
        navy: {
          DEFAULT: '#0A1F66',
          soft: '#1a2f7a',
        },
        // brand = azul principal (mantengo nombre por compatibilidad,
        // pero ahora alineado con #1565F0 del brandbook)
        brand: {
          50: '#eef7ff',
          100: '#d9ecff',
          200: '#bcdfff',
          300: '#8ecbff',
          400: '#59adff',
          500: '#3FA9FF',  // = cyan brandbook
          600: '#1565F0',  // = blue brandbook
          700: '#0f4fbf',  // = blue-dark
          800: '#1748b4',
          900: '#0A1F66',  // = navy
          950: '#06143d',
        },
        cyan: {
          DEFAULT: '#3FA9FF',
        },
        ice: {
          DEFAULT: '#E8F2FF',
        },
        accent: {
          DEFAULT: '#FF5A1F',  // = orange brandbook
          dark: '#e64a0f',
        },
        ink: {
          DEFAULT: '#0A0A0A',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['"Space Grotesk"', 'system-ui', 'sans-serif'],
      },
      backgroundImage: {
        'brand-gradient': 'linear-gradient(135deg, #0A1F66 0%, #1565F0 100%)',
      },
    },
  },
  plugins: [],
};
