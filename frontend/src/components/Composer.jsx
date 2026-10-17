import React, { useState } from "react";
import { Icons } from "./Icons";
import { useVoiceInput } from "../hooks/useVoiceInput";

export default function Composer({ onAddTodo, showToast, inputRef }) {
  const [text, setText] = useState("");

  const { listening, hint, toggleVoice } = useVoiceInput({
    onTranscriptChange: (val) => setText(val),
    onFinalTodo: (finalVal) => onAddTodo(finalVal),
    showToast,
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    onAddTodo(trimmed);
    setText("");
    inputRef.current?.focus();
  };

  return (
    <div className="composer">
      <form onSubmit={handleSubmit} autoComplete="off">
        <input
          ref={inputRef}
          className="input"
          placeholder="Add todo"
          maxLength={300}
          aria-label="Add todo"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button
          type="button"
          className={`mic ${listening ? "live" : ""}`}
          onClick={toggleVoice}
          aria-label="Add todo by voice"
        >
          <Icons.Mic />
        </button>
        <button type="submit" className="send" aria-label="Add">
          <Icons.Plus />
        </button>
      </form>
      <div className="hint">{hint}</div>
    </div>
  );
}