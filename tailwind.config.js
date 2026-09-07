/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // CineVault Dark Glassmorphism Theme
        'dark-bg': '#0f1115',
        'dark-glass': '#1a1c23',
        'accent-orange': '#ff9900',
        'text-primary': '#ffffff',
        'text-secondary': '#8b94a6',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        'orange-glow': '0 0 20px rgba(255, 153, 0, 0.3)',
        'orange-glow-lg': '0 0 40px rgba(255, 153, 0, 0.2)',
      },
    },
  },
  plugins: [],
}