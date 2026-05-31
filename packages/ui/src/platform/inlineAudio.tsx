/**
 * Inline audio player — web impl.
 *
 * Wraps the HTML `<audio controls>` element. React Native Web
 * forwards unknown JSX children to DOM, so a bare `<audio>` here
 * renders the native HTML5 player when consumed from the web bundle.
 *
 * Native sibling (`inlineAudio.native.tsx`) does fetch+decode on
 * iOS and throws-with-friendly-message on macOS until M22.
 *
 * Moved from `conversations/InlineAudioPlayer.tsx` (M21 step 2).
 * The legacy path stays as a one-line re-export until step 6 cleans
 * up consumer imports.
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
