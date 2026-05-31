/**
 * Inline audio player — RN impl.
 *
 * iOS: fetch the URL, decode via audio-api's `decodeAudioData`, play
 * via AudioBufferSource — the same Web Audio path the web impl uses,
 * just at the audio-api layer. ~200 ms tap-to-play; fine for a
 * history-playback UI control (Decision 3).
 *
 * macOS: placeholder text until M22 lands the AVAudioPlayer bridge.
 *
 * Component name + props match the web impl so consumers can render
 * `<InlineAudioPlayer src={url} />` against either target.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import {
  AudioContext,
  decodeAudioData,
  type AudioBufferSourceNode,
} from "react-native-audio-api";

type Props = {
  src: string;
};

type Phase = "idle" | "loading" | "playing" | "error";

function IosInlineAudioPlayer({ src }: Props) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const nodeRef = useRef<AudioBufferSourceNode | null>(null);

  useEffect(() => {
    return () => {
      try {
        nodeRef.current?.stop();
      } catch {
        // best-effort
      }
      void ctxRef.current?.close();
    };
  }, []);

  const handlePlay = useCallback(async () => {
    if (phase === "loading" || phase === "playing") return;
    setError(null);
    setPhase("loading");
    try {
      if (!ctxRef.current) {
        ctxRef.current = new AudioContext();
      }
      const ctx = ctxRef.current;
      const buf = await decodeAudioData(src, ctx.sampleRate);
      const node = ctx.createBufferSource();
      node.buffer = buf;
      node.connect(ctx.destination);
      nodeRef.current = node;
      node.start();
      setPhase("playing");
      // The node emits an 'ended' event but the audio-api wrapper
      // doesn't expose it via the React surface; fall back to a
      // timer matched to the buffer's duration.
      setTimeout(
        () => {
          if (nodeRef.current === node) {
            nodeRef.current = null;
            setPhase("idle");
          }
        },
        Math.ceil(buf.duration * 1000) + 50,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setPhase("error");
    }
  }, [phase, src]);

  const label =
    phase === "loading" ? "Loading…" : phase === "playing" ? "Playing" : "Play recording";

  return (
    <View style={styles.row}>
      <Pressable
        onPress={handlePlay}
        style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
      >
        <Text style={styles.buttonLabel}>{label}</Text>
      </Pressable>
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

function MacosInlineAudioPlayer({ src: _src }: Props) {
  // User-facing string — no internal milestone numbers (Wren FINDING-2).
  return <Text style={styles.placeholder}>Audio playback on macOS is coming soon.</Text>;
}

export function InlineAudioPlayer(props: Props) {
  if (Platform.OS === "macos") return <MacosInlineAudioPlayer {...props} />;
  return <IosInlineAudioPlayer {...props} />;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  button: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 0.5,
    borderColor: "#cccccc",
    backgroundColor: "#f5f5f5",
  },
  buttonPressed: {
    opacity: 0.7,
  },
  buttonLabel: {
    fontSize: 13,
  },
  placeholder: {
    fontSize: 13,
    fontStyle: "italic",
    color: "#8b8b90",
  },
  error: {
    fontSize: 11,
    color: "#b00020",
  },
});
