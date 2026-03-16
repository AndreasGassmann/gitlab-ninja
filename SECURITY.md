# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability, please report it through [GitHub's private vulnerability reporting](https://github.com/AndreasGassmann/gitlab-ninja/security/advisories/new).

**Do not open a public issue for security vulnerabilities.**

## Scope

Security issues we're particularly interested in:

- **XSS** — The extension injects UI into GitLab pages; any way to execute arbitrary scripts is critical
- **Credential leakage** — The extension stores a GitLab API token; any way to exfiltrate it is critical
- **Overly broad permissions** — If the extension requests more browser permissions than necessary

## Response

We aim to acknowledge reports within 48 hours and provide a fix or mitigation plan within 7 days.
