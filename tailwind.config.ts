import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Đồng bộ 100% bảng màu Hồng Cà Xòi (từ Hồng sữa nhạt -> Hồng dâu -> Hồng Berry đậm thay thế hoàn toàn màu nâu)
        coffee: {
          950: "#2D0819",
          900: "#420E26",
          800: "#581533",
          700: "#6E2042",
          600: "#883155",
          500: "#A44B6E",
          400: "#C97092",
          300: "#F49AC1",
          200: "#FBCFE8",
          100: "#FFE4EE",
          50: "#FFF5F8",
        },
        caramel: {
          DEFAULT: "#EC4899",
          dark: "#DB2777",
          light: "#F472B6",
        },
        cream: {
          DEFAULT: "#FFF7FA",
          muted: "#FFEFF5",
        },
        caxoi: {
          pink: "#FFD6E5",
          pinkLight: "#FFF0F5",
          rose: "#E11D48",
          coral: "#F43F5E",
          yellow: "#F472B6",
          egg: "#FCE7F3",
          cat: "#6E2042",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "Inter", "sans-serif"],
      },
    },
  },
  plugins: [],
};
export default config;
