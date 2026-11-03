"use client";
import {
  useLayoutEffect,
  useRef,
  useState,
  type InputHTMLAttributes,
} from "react";

export function FullTextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  const input = useRef<HTMLInputElement>(null);
  const [overflow, setOverflow] = useState(false);
  useLayoutEffect(() => {
    const element = input.current;
    if (!element) return;
    const measure = () =>
      setOverflow(element.scrollWidth > element.clientWidth + 1);
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    const frame = requestAnimationFrame(measure);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [props.value]);
  return (
    <span className="full-text-input">
      <input {...props} ref={input} />
      {overflow && props.type !== "password" && (
        <span className="full-text-input-value" aria-hidden="true">
          {String(props.value ?? "")}
        </span>
      )}
    </span>
  );
}
