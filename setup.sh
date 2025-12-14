#!/usr/bin/env bash
set -e

echo "::group::Installing k3s"
echo "Starting k3s setup..."

# Read inputs
VERSION="${INPUT_VERSION:-stable}"
K3S_ARGS="${INPUT_K3S_ARGS:---write-kubeconfig-mode 644}"
WAIT_FOR_READY="${INPUT_WAIT_FOR_READY:-true}"
TIMEOUT="${INPUT_TIMEOUT:-120}"
DNS_READINESS="${INPUT_DNS_READINESS:-true}"

echo "Configuration: version=$VERSION, k3s-args=\"$K3S_ARGS\", wait-for-ready=$WAIT_FOR_READY, timeout=${TIMEOUT}s, dns-readiness=$DNS_READINESS"

# Install k3s
echo "Installing k3s $VERSION..."

# Prepare installation command
INSTALL_CMD="curl -sfL https://get.k3s.io | "

if [ "$VERSION" != "stable" ] && [ "$VERSION" != "latest" ]; then
  INSTALL_CMD+="INSTALL_K3S_VERSION=\"$VERSION\" "
elif [ "$VERSION" = "latest" ]; then
  INSTALL_CMD+="INSTALL_K3S_CHANNEL=\"latest\" "
else
  INSTALL_CMD+="INSTALL_K3S_CHANNEL=\"stable\" "
fi

INSTALL_CMD+="sh -s - $K3S_ARGS"

echo "Install command: $INSTALL_CMD"
eval "$INSTALL_CMD"

echo "Waiting for k3s service to start..."
sleep 10

# Verify service is running
if ! sudo systemctl is-active --quiet k3s; then
  echo "::error::k3s service failed to start"
  sudo systemctl status k3s || true
  sudo journalctl -u k3s -n 100 --no-pager || true
  exit 1
fi

echo "✓ k3s installed successfully"
echo "::endgroup::"

# Set kubeconfig path
KUBECONFIG_PATH="/etc/rancher/k3s/k3s.yaml"
echo "kubeconfig=$KUBECONFIG_PATH" >> "$GITHUB_OUTPUT"
echo "KUBECONFIG=$KUBECONFIG_PATH" >> "$GITHUB_ENV"

# Wait for cluster ready if requested
if [ "$WAIT_FOR_READY" = "true" ]; then
  echo "::group::Waiting for cluster ready"
  echo "Waiting for k3s cluster to be ready (timeout: ${TIMEOUT}s)..."
  
  START_TIME=$(date +%s)
  
  while true; do
    ELAPSED=$(($(date +%s) - START_TIME))
    
    if [ "$ELAPSED" -gt "$TIMEOUT" ]; then
      echo "::error::Timeout waiting for cluster to be ready"
      echo "=== Diagnostic Information ==="
      sudo systemctl status k3s || true
      sudo journalctl -u k3s -n 100 --no-pager || true
      ls -la /etc/rancher/k3s/ || true
      exit 1
    fi
    
    # Check if k3s service is active
    if sudo systemctl is-active --quiet k3s; then
      # Check if kubeconfig exists
      if [ -f "$KUBECONFIG_PATH" ]; then
        # Verify kubectl can connect
        if kubectl --kubeconfig "$KUBECONFIG_PATH" get nodes --no-headers &>/dev/null; then
          # Verify node is Ready
          if kubectl --kubeconfig "$KUBECONFIG_PATH" get nodes --no-headers | grep -q " Ready "; then
            echo "Node is Ready"
            
            # Verify essential system pods are running
            # Check for coredns (essential DNS) - must be running
            if kubectl --kubeconfig "$KUBECONFIG_PATH" get pods -n kube-system -l k8s-app=kube-dns --no-headers 2>/dev/null | grep -q "Running"; then
              echo "  CoreDNS is running"
              
              # Check that there are no critical pods (excluding Jobs) stuck in Error/CrashLoopBackOff
              # Jobs may crash/retry during installation, which is normal
              CRITICAL_FAILING=$(kubectl --kubeconfig "$KUBECONFIG_PATH" get pods -n kube-system --no-headers 2>/dev/null | grep -v "helm-install" | grep -E "Error|CrashLoopBackOff" | wc -l || echo "0")
              
              if [ "$CRITICAL_FAILING" = "0" ]; then
                echo "  No critical pods failing"
                echo "KUBECONFIG exported: $KUBECONFIG_PATH"
                
                # Show cluster info
                kubectl --kubeconfig "$KUBECONFIG_PATH" get nodes
                kubectl --kubeconfig "$KUBECONFIG_PATH" get pods -A
                
                echo "✓ k3s cluster is fully ready!"
                echo "Note: Helm install jobs may still be running in the background to install optional components like Traefik"
                echo "::endgroup::"
                break
              fi
            fi
          fi
        fi
      fi
    fi
    
    echo "Cluster not ready yet, waiting... (${ELAPSED}/${TIMEOUT}s)"
    sleep 5
    done
fi

# DNS readiness check (if requested)
if [ "$DNS_READINESS" = "true" ]; then
  echo "::group::Testing DNS readiness"
  echo "Verifying CoreDNS and DNS resolution..."
  
  # Wait for CoreDNS pods to be ready
  echo "Waiting for CoreDNS to be ready..."
  kubectl --kubeconfig "$KUBECONFIG_PATH" wait --for=condition=ready --timeout=120s pod -l k8s-app=kube-dns -n kube-system
  echo "✓ CoreDNS is ready"
  
  # Create a test pod and verify DNS resolution
  kubectl --kubeconfig "$KUBECONFIG_PATH" run dns-test --image=busybox:stable --restart=Never -- sleep 300
  kubectl --kubeconfig "$KUBECONFIG_PATH" wait --for=condition=ready --timeout=60s pod/dns-test
  
  if kubectl --kubeconfig "$KUBECONFIG_PATH" exec dns-test -- nslookup kubernetes.default.svc.cluster.local; then
    echo "✓ DNS resolution is working"
  else
    echo "::error::DNS resolution failed"
    kubectl --kubeconfig "$KUBECONFIG_PATH" delete pod dns-test --ignore-not-found
    exit 1
  fi
  
  # Cleanup test pod
  kubectl --kubeconfig "$KUBECONFIG_PATH" delete pod dns-test --ignore-not-found
  echo "::endgroup::"
fi

echo "✓ k3s setup completed successfully!"
