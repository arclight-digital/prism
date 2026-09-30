import { css } from 'lit';

/** A shared module that sets private properties on the host, like arc-ui's statusVars. */
export const statusVars = css`
  :host {
    --_status-rgb: var(--accent-rgb);
  }
  :host([variant="error"]) {
    --_status-rgb: var(--error-rgb);
  }
`;
