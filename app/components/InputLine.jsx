'use client';

import { useState, useRef, useEffect } from 'react';

export default function InputLine({ onSubmit, placeholder, disabled }) {
  const [value, setValue] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (inputRef.current && !disabled) {
      inputRef.current.focus();
    }
  }, [disabled]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (value.trim() && onSubmit) {
      onSubmit(value.trim());
      setValue('');
    }
  };

  return (
    <form onSubmit={handleSubmit} className="input-line">
      <span className="input-line__prefix">user@newsfeed:~$&nbsp;</span>
      <input
        ref={inputRef}
        type="text"
        className="input-line__field"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder || 'type a command...'}
        disabled={disabled}
        autoComplete="off"
        spellCheck="false"
      />
      {!value && !disabled && <span className="input-line__cursor" />}
    </form>
  );
}
