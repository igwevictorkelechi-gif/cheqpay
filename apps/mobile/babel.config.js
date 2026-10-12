module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // rem 15, as the website uses on phones (globals.css), so Tailwind sizes match.
      ['nativewind/babel', { rem: 15 }],
      'react-native-reanimated/plugin',
    ],
  };
};
