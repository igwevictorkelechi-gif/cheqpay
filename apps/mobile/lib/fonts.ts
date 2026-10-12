// The Plus Jakarta Sans faces the app uses (400-800, as on the website), under
// the names lib/typeface.js maps each fontWeight to. Loaded once in the root
// layout before anything renders.
import { PlusJakartaSans_400Regular } from '@expo-google-fonts/plus-jakarta-sans/400Regular';
import { PlusJakartaSans_500Medium } from '@expo-google-fonts/plus-jakarta-sans/500Medium';
import { PlusJakartaSans_600SemiBold } from '@expo-google-fonts/plus-jakarta-sans/600SemiBold';
import { PlusJakartaSans_700Bold } from '@expo-google-fonts/plus-jakarta-sans/700Bold';
import { PlusJakartaSans_800ExtraBold } from '@expo-google-fonts/plus-jakarta-sans/800ExtraBold';

export const FONTS = {
  'Jakarta-400': PlusJakartaSans_400Regular,
  'Jakarta-500': PlusJakartaSans_500Medium,
  'Jakarta-600': PlusJakartaSans_600SemiBold,
  'Jakarta-700': PlusJakartaSans_700Bold,
  'Jakarta-800': PlusJakartaSans_800ExtraBold,
};
