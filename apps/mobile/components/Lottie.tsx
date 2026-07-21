import LottieView from 'lottie-react-native';

/** Brand success animation: circle pop + check draw + ring flash. Plays once. */
export function SuccessAnimation({ size = 130 }: { size?: number }) {
  return (
    <LottieView
      source={require('../assets/lottie/success.json')}
      autoPlay
      loop={false}
      style={{ width: size, height: size }}
    />
  );
}

/** Brand three-dot loading animation. Loops. */
export function LoadingAnimation({ size = 90 }: { size?: number }) {
  return (
    <LottieView
      source={require('../assets/lottie/loading.json')}
      autoPlay
      loop
      style={{ width: size, height: size }}
    />
  );
}
