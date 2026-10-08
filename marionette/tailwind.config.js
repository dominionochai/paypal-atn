/** @type {import('tailwindcss').Config} */
module.exports = {
  mode: "jit",
  darkMode: "class",
  content: ["./popup.tsx", "./background/**/*.tsx", "./sidepanel.tsx", "./contents/**/*.tsx", "./tabs/**/*.tsx", "./components/**/*.tsx", "./screens/**/*.tsx"],
  plugins: []
}
