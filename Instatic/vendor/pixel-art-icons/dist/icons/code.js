import { jsx as _jsx } from "react/jsx-runtime";
export function CodeIcon({ size = 24, color = 'currentColor', className, style }) {
    return (_jsx("i", { className: `ri-code-line${className ? ' ' + className : ''}`, "aria-hidden": "true", style: { fontSize: size, width: size, height: size, lineHeight: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color, ...style } }));
}
