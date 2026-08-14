/**
 * DOM ids the Studio uses to portal a control from the component that owns its
 * state into the row the approved layout puts it in.
 *
 * Lives in its own module because both `FileWorkspace` (which renders the host)
 * and `FileViewer` (which fills it) need the id, and FileWorkspace already
 * imports FileViewer — importing back would close a cycle.
 */

/**
 * Right end of the file-tab row. Holds the Desktop/Tablet/Mobile switcher,
 * which the approved Studio draws there (`prototype-reference/src/Workspace.jsx:707`)
 * even though the viewport itself is the viewer's state.
 */
export const WORKSPACE_VIEWPORT_SLOT_ID = 'ws-viewport-slot';
