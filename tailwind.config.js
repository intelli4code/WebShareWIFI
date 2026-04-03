/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          dark: '#0B0F1A',
          card: '#141B2D',
          border: 'rgba(255, 255, 255, 0.08)',
          accent: '#3B82F6', // Blue-500
          success: '#10B981' // Emerald-500
        }
      },
      borderRadius: {
        'xl': '0.75rem',
        '2xl': '1rem'
      }
    }
  },
  plugins: []
};

