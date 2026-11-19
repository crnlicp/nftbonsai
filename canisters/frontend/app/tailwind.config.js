/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        moss: {
          50: "#f1f9f2",
          100: "#dcefe0",
          200: "#bbdfc4",
          300: "#8cc89c",
          400: "#5bac72",
          500: "#3a9054",
          600: "#287342",
          700: "#205c37",
          800: "#1c4a2f",
          900: "#193d28",
        },
      },
      fontFamily: {
        display: ['"Plus Jakarta Sans"', "system-ui", "sans-serif"],
        body: ["system-ui", "sans-serif"],
      },
      backdropBlur: {
        xs: "2px",
      },
      boxShadow: {
        glass: "0 8px 32px 0 rgba(8, 20, 16, 0.45)",
      },
    },
  },
  plugins: [],
};
