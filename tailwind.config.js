/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    screens: {
      'xs': '375px',
      'sm': '640px',
      'md': '768px',
      'lg': '1024px',
      'xl': '1280px',
      '2xl': '1536px',
    },
    extend: {
      colors: {
        forest: {
          50:  '#f4f7f0',
          100: '#e6edd9',
          200: '#cedbb5',
          300: '#afc28a',
          400: '#8fa864',
          500: '#6d8c44',
          600: '#4a6630',
          700: '#3a5226',
          800: '#2e421e',
          900: '#263618',
          950: '#111c0a',
        },
        cream: '#f5f5f0',
        parchment: '#eeede8',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      animation: {
        'pulse-slow':  'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'ping-slow':   'ping-slow 2s cubic-bezier(0, 0, 0.2, 1) infinite',
        'spin-slow':   'spin 12s linear infinite',
      },
      boxShadow: {
        'card': '0 2px 8px rgba(0,0,0,0.06)',
        'card-hover': '0 4px 16px rgba(0,0,0,0.10)',
      },
    },
  },
  plugins: [],
}
