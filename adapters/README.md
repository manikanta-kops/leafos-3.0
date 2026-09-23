# Execution adapters

Adapters connect LeafOS Core to AI providers. Each adapter is an independently
installable package with its own dependencies and lockfile.

Use `@leafos/core/adapter` for the public contract and receive Core host services
through a factory. Keep provider-specific code inside the adapter.

No production adapters are implemented yet.
