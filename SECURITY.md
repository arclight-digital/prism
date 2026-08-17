# Security Policy

## Reporting a vulnerability

If you discover a security vulnerability, please report it responsibly by emailing security@arclux.dev.

Please do **not** open a public GitHub issue for security vulnerabilities.

## Scope

@arclux/prism is a code generator that reads local files and writes local files. It does not:
- Make network requests
- Execute user-provided code — beyond importing the config file, and, when `config.runtime` is opted into, importing the component modules themselves
- Access credentials or secrets

Security concerns are primarily around file path handling and regex performance.
