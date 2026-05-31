/**
 * Inline audio player — web default.
 *
 * Wraps the HTML `<audio controls>` element so consumers (today:
 * ConversationDetail's "Listen back" section) can render audio
 * playback the same way across targets. React Native Web forwards
 * unknown JSX children to DOM, so a bare `<audio>` tag here renders
 * the native HTML5 player in the browser.
 *
 * The `.native.tsx` companion is a stub until M22 lands the AVPlayer
 * (iOS) / AVAudioPlayer (macOS) bridges.
 */

type Props = {
  src: string;
};

const audioStyle = {
  width: "100%",
  maxWidth: 480,
} as const;

export function InlineAudioPlayer({ src }: Props) {
  return <audio controls preload="metadata" src={src} style={audioStyle} />;
}
