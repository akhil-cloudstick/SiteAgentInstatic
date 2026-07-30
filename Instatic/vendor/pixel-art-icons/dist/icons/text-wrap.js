import { jsx as _jsx } from "react/jsx-runtime";
export function TextWrapIcon({ size = 24, color = 'currentColor', className, style }) {
    return (_jsx("i", { className: `ri-text-wrap${className ? ' ' + className : ''}`, "aria-hidden": "true", style: { fontSize: size, width: size, height: size, lineHeight: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color, ...style } }));
}
