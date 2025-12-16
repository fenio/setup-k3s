# Setup k3s Action

A simple GitHub Action for installing and configuring [k3s](https://k3s.io) - a lightweight, certified Kubernetes distribution perfect for CI/CD pipelines, testing, and development workflows.

## Features

- ✅ Automatic installation of k3s
- ✅ Waits for cluster readiness (nodes and system pods)
- ✅ Outputs kubeconfig path for easy integration
- ✅ Configurable k3s arguments for customization
- ✅ No cleanup required - designed for ephemeral GitHub Actions runners

## Quick Start

```yaml
name: Test with k3s

on: [push]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup k3s
        id: k3s
        uses: fenio/setup-k3s@v2
      
      - name: Deploy and test
        env:
          KUBECONFIG: ${{ steps.k3s.outputs.kubeconfig }}
        run: |
          kubectl apply -f k8s/
          kubectl wait --for=condition=available --timeout=60s deployment/my-app
```

## Inputs

| Input | Description | Default |
|-------|-------------|---------|
| `version` | k3s version to install (e.g., `v1.28.5+k3s1`, `latest`, `stable`) | `stable` |
| `k3s-args` | Additional arguments to pass to k3s installer | `--write-kubeconfig-mode 644` |
| `wait-for-ready` | Wait for cluster to be ready before completing | `true` |
| `timeout` | Timeout in seconds to wait for cluster readiness | `120` |
| `dns-readiness` | Wait for CoreDNS to be ready and verify DNS resolution works | `true` |

## Outputs

| Output | Description |
|--------|-------------|
| `kubeconfig` | Path to the kubeconfig file (`/etc/rancher/k3s/k3s.yaml`) |

## Examples

### Basic Usage

```yaml
- name: Setup k3s
  uses: fenio/setup-k3s@v2
```

### Specific Version

```yaml
- name: Setup k3s v1.28.5
  uses: fenio/setup-k3s@v2
  with:
    version: v1.28.5+k3s1
```

### Disable Components

```yaml
- name: Setup k3s (minimal)
  uses: fenio/setup-k3s@v2
  with:
    k3s-args: '--write-kubeconfig-mode 644 --disable=traefik --disable=servicelb'
```

### Latest Version

```yaml
- name: Setup k3s (latest)
  uses: fenio/setup-k3s@v2
  with:
    version: latest
```

## How It Works

1. Installs k3s using the official installation script from https://get.k3s.io
2. Waits for the k3s service to start
3. Waits for the cluster to become ready (nodes Ready, system pods Running)
4. Exports `KUBECONFIG` environment variable and output

**No cleanup needed** - GitHub Actions runners are ephemeral and destroyed after each workflow run, so there's no need to restore system state.

## Requirements

- Runs on `ubuntu-latest` (or any Linux-based runner)
- Requires `sudo` access (provided by default in GitHub Actions)

## Version Selection

The `version` input accepts:
- **`stable`** (default) - Latest stable release channel
- **`latest`** - Latest release (including pre-releases)
- **Specific version** - e.g., `v1.28.5+k3s1` (see [k3s releases](https://github.com/k3s-io/k3s/releases))

## Troubleshooting

### Cluster not becoming ready

If the cluster doesn't become ready in time, increase the timeout:

```yaml
- name: Setup k3s
  uses: fenio/setup-k3s@v2
  with:
    timeout: 300  # 5 minutes
```

### Background installation of optional components

k3s includes optional components like Traefik (ingress controller) that are installed via Helm jobs in the background. The action considers the cluster ready when:
- The node is Ready
- CoreDNS (essential for DNS resolution) is running
- No critical pods are failing (Helm install jobs are excluded as they may retry)

Helm install jobs may show as CrashLoopBackOff temporarily while waiting for dependencies - this is normal. Traefik and other components will become available shortly after the action completes.

### Custom k3s arguments

To pass custom arguments to k3s:

```yaml
- name: Setup k3s
  uses: fenio/setup-k3s@v2
  with:
    k3s-args: |
      --write-kubeconfig-mode 644
      --disable=traefik
      --disable=servicelb
      --kube-apiserver-arg=feature-gates=EphemeralContainers=true
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Related Projects

- [k3s](https://k3s.io) - Lightweight Kubernetes

### Other Kubernetes Setup Actions

- [setup-k0s](https://github.com/fenio/setup-k0s) - Zero friction Kubernetes (k0s)
- [setup-kubesolo](https://github.com/fenio/setup-kubesolo) - Ultra-lightweight Kubernetes
- [setup-microk8s](https://github.com/fenio/setup-microk8s) - Lightweight Kubernetes by Canonical
- [setup-minikube](https://github.com/fenio/setup-minikube) - Local Kubernetes (Minikube)
- [setup-talos](https://github.com/fenio/setup-talos) - Secure, immutable Kubernetes OS (Talos)
