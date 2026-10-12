// Web preview only: babel-preset-expo rewrites `import { Text } from 'react-native'`
// to this export's own module on web, so metro.config.js points it here.
module.exports = require('./typeface').Text;
