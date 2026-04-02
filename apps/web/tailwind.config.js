/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#112031",
        mist: "#e7f6f2",
        ember: "#f66b0e",
        slate: "#205375"
      }
    }
  },
  plugins: []
};
