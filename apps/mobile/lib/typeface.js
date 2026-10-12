// CheqPay's typeface, Plus Jakarta Sans, on every Text and TextInput in the app.
//
// The website sets one font on <body>; React Native has no such thing, and on
// Android `fontWeight` does not pick a weight from a custom family, so each
// weight is its own registered font. Rather than touch the ~2,000 Text
// elements, metro.config.js resolves `react-native` imported from this app's
// own code to this module: the real react-native with Text and TextInput
// swapped for versions that turn fontWeight into the matching Jakarta face.
// Code inside node_modules (icon fonts, navigation) gets the real module.
//
// Plain JS on purpose: it must not be type-checked against itself, and app code
// keeps react-native's own types.

const React = require('react');
const RN = require('react-native');

/** Registered names (see lib/fonts.ts) by CSS weight. */
const FACE = {
  100: 'Jakarta-400',
  200: 'Jakarta-400',
  300: 'Jakarta-400',
  400: 'Jakarta-400',
  500: 'Jakarta-500',
  600: 'Jakarta-600',
  700: 'Jakarta-700',
  800: 'Jakarta-800',
  900: 'Jakarta-800',
};

function weightOf(w) {
  if (w === 'bold') return 700;
  if (w === undefined || w === null || w === 'normal') return 400;
  const n = Number(w);
  return Number.isFinite(n) ? Math.min(900, Math.max(100, Math.round(n / 100) * 100)) : 400;
}

/** The style with the Jakarta face for its weight, unless it names its own font. */
function withFace(style) {
  const flat = RN.StyleSheet.flatten(style) || {};
  if (flat.fontFamily && !/^System/.test(flat.fontFamily)) return style;
  // The face carries the weight; also asking for a weight would make Android
  // embolden an already-bold face.
  return [style, { fontFamily: FACE[weightOf(flat.fontWeight)], fontWeight: 'normal' }];
}

const Text = React.forwardRef(function CheqPayText(props, ref) {
  return React.createElement(RN.Text, { ...props, ref, style: withFace(props.style) });
});
Text.displayName = 'Text';

const TextInput = React.forwardRef(function CheqPayTextInput(props, ref) {
  return React.createElement(RN.TextInput, { ...props, ref, style: withFace(props.style) });
});
TextInput.displayName = 'TextInput';
// Keep TextInput.State (focus helpers) reachable as on the real component.
TextInput.State = RN.TextInput.State;

const out = {};
for (const key of Object.getOwnPropertyNames(RN)) {
  if (key === 'Text' || key === 'TextInput') continue;
  // Getters, so react-native's lazy exports stay lazy.
  Object.defineProperty(out, key, { enumerable: true, get: () => RN[key] });
}
out.Text = Text;
out.TextInput = TextInput;

module.exports = out;
