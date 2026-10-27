module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      [
        'module-resolver',
        {
          root: ['.'],
          alias: {
            '@core': './src/core',
            '@modules': './src/modules',
            '@app': './src/app',
          },
          extensions: [
            '.ios.ts',
            '.android.ts',
            '.ts',
            '.tsx',
            '.js',
            '.jsx',
            '.json',
          ],
        },
      ],
    ],
  };
};
