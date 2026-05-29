/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{vue,ts}'],
  theme: {
    extend: {
      colors: {
        bg: '#05080f',
        panel: '#111827',
        panel2: '#0d1422',
        line: '#1f2a3d',
        fg: '#cdd9ee',
        muted: '#5d6b85',
        accent: '#5ad1c9',
        accent2: '#8a7bff',
        gold: '#e8b54a',
        bad: '#ff6b81',
        good: '#5ad17a',
      },
      fontFamily: {
        mono: ['DejaVu Sans Mono', 'Menlo', 'Consolas', 'monospace'],
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
