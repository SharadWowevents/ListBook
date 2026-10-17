import { useState, useRef } from "react";

export function useVoiceInput({ onTranscriptChange, onFinalTodo, showToast }) {
  const [listening, setListening] = useState(false);
  const [hint, setHint] = useState("");
  const recRef = useRef(null);

  const toggleVoice = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      showToast("Voice input isn't supported in this browser. Try Chrome or Safari.");
      return;
    }
    if (listening && recRef.current) {
      recRef.current.stop();
      return;
    }

    const rec = new SR();
    recRef.current = rec;
    rec.lang =
      navigator.language && navigator.language.startsWith("en")
        ? navigator.language
        : "en-IN";
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;

    let finalText = "";

    rec.onstart = () => {
      setListening(true);
      setHint("Listening… say your todo.");
    };

    rec.onresult = (ev) => {
      let interim = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interim += r[0].transcript;
      }
      onTranscriptChange((finalText + interim).trim());
    };

    rec.onerror = (ev) => {
      const messages = {
        "not-allowed":
          "Microphone access is blocked here. Allow the mic, or open Listbook in Chrome or Safari directly to use voice.",
        "service-not-allowed":
          "Microphone access is blocked here. Open Listbook in Chrome or Safari directly to use voice.",
        "no-speech": "Didn't catch that. Tap the mic and try again.",
        "audio-capture": "No microphone found.",
        network: "Voice needs an internet connection.",
      };
      showToast(messages[ev.error] || "Voice input stopped. Try again.", 5000);
    };

    rec.onend = () => {
      setListening(false);
      setHint("");
      const text = finalText.trim();
      if (text) {
        const formatted = text.charAt(0).toUpperCase() + text.slice(1);
        onFinalTodo(formatted);
        onTranscriptChange("");
        showToast("Added: " + formatted, 2200);
      }
    };

    try {
      rec.start();
    } catch {
      showToast("Couldn't start the microphone. Try again.");
    }
  };

  return { listening, hint, toggleVoice };
}