const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');

module.exports = {
  entry: {
    content: './src/content.ts',
    injected: './src/injected.ts',
    popup: './src/popup.ts',
    options: './src/options.ts',
    background: './src/background.ts',
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader'],
      },
    ],
  },
  resolve: {
    extensions: ['.tsx', '.ts', '.js'],
  },
  output: {
    filename: '[name].js',
    path: path.resolve(__dirname, 'dist'),
    clean: true,
  },
  plugins: [
    new CopyPlugin({
      patterns: [
        { from: 'manifests/manifest.json', to: 'manifest.json' },
        { from: 'manifests/manifest_firefox.json', to: 'manifest_firefox.json' },
        { from: 'manifests/manifest_safari.json', to: 'manifest_safari.json' },
        { from: 'icons', to: 'icons' },
        { from: 'src/styles.css', to: 'styles.css' },
        { from: 'src/popup.html', to: 'popup.html' },
        { from: 'src/options.html', to: 'options.html' },
      ],
    }),
  ],
  devtool: 'source-map',
};
