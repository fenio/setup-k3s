# AGENTS.md

This file provides comprehensive documentation about the setup-k3s GitHub Action for AI agents and developers working with this codebase.

## ⚠️ CRITICAL PRINCIPLE: SYSTEM STATE RESTORATION ⚠️

**THE MOST IMPORTANT REQUIREMENT OF THIS ACTION:**

This action MUST leave the system in EXACTLY the same state as it was before the action ran. This is a non-negotiable requirement.

### Why This Matters
GitHub Actions assume that each workflow runs on a pristine Ubuntu fresh install. Any changes made during setup (installing binaries, creating files, starting services) MUST be completely reversed during cleanup. Failure to restore the system state can break subsequent workflows or leave orphaned processes and files.

### What Must Be Restored
Every operation in the setup phase has a corresponding cleanup operation:

| Setup Operation | Cleanup Operation | Location |
|----------------|-------------------|----------|
| Install k3s via install script | Uninstalled via `/usr/local/bin/k3s-uninstall.sh` (removes binary) | `src/cleanup.ts:46` |
| Start k3s systemd service | Stopped and removed by k3s-uninstall.sh | `src/cleanup.ts:46` |
| Create kubeconfig at `/etc/rancher/k3s/k3s.yaml` | Removed by k3s-uninstall.sh and explicit cleanup | `src/cleanup.ts:55` |
| Create k3s data directory `/var/lib/rancher/k3s` | Removed by explicit cleanup | `src/cleanup.ts:55` |
| Set KUBECONFIG environment variable | No cleanup needed - job-scoped only | N/A |

### Cleanup Guarantees
- Cleanup runs automatically via GitHub Actions `post:` hook - it ALWAYS runs, even if the workflow fails
- Cleanup is non-failing (`ignoreReturnCode: true`) to ensure it completes even if some operations encounter errors
- The k3s install script provides an uninstall script that removes all k3s components

### When Making Changes
**BEFORE adding any new setup operation, you MUST add the corresponding cleanup operation.**

If you:
- Create a file → Delete it in cleanup
- Modify a config → Restore original in cleanup
- Stop a service → Restart it in cleanup
- Install a package → Uninstall it in cleanup

**Violating this principle will break other workflows and is unacceptable.**

---

## Project Overview

**setup-k3s** is a GitHub Action that installs and configures k3s - Lightweight certified Kubernetes distribution for CI/CD. The action handles both setup and automatic cleanup/restoration of the system state.

### Key Features
- Automatic installation of k3s with version/channel selection
- Support for custom k3s arguments
- Cluster readiness checks with configurable timeout
- **Automatic post-run cleanup and complete system restoration** (MOST IMPORTANT FEATURE)
- Outputs kubeconfig path for easy integration with kubectl

## Architecture

### Entry Point Flow
The action uses GitHub Actions' `post:` hook mechanism for automatic cleanup:

1. **Main Run** (`src/index.ts`): Entry point that routes to either main or cleanup based on state
2. **Setup Phase** (`src/main.ts`): Handles k3s installation and configuration
3. **Cleanup Phase** (`src/cleanup.ts`): Automatically runs after job completion for restoration

### Execution Phases

#### Phase 1: Setup (src/main.ts)

```
installK3s() → waitForClusterReady()
```

**installK3s(version, k3sArgs)**
- Resolves version/channel (latest, stable, or specific version)
- Uses official k3s install script from https://get.k3s.io
- Passes custom arguments to k3s installer
- Waits for k3s service to start
- Verifies service is active
- Location: `src/main.ts:39-84`

**waitForClusterReady(timeout)**
- Polls for cluster readiness with configurable timeout
- Checks: k3s service active → kubeconfig exists → kubectl connects → node Ready → system pods running
- Sets KUBECONFIG output and environment variable
- Shows cluster info when ready
- Location: `src/main.ts:86-172`

#### Phase 2: Cleanup (src/cleanup.ts)

```
uninstallK3s()
```

**uninstallK3s()**
- Checks if k3s service is active
- Runs `/usr/local/bin/k3s-uninstall.sh` if it exists
- Explicitly removes remaining directories (`/etc/rancher/k3s`, `/var/lib/rancher/k3s`)
- Location: `src/cleanup.ts:22-61`

## File Structure

```
setup-k3s/
├── src/
│   ├── index.ts         # Entry point - routes to main or cleanup
│   ├── main.ts          # Setup phase implementation
│   └── cleanup.ts       # Cleanup phase implementation
├── dist/                # Compiled JavaScript (via @vercel/ncc)
│   ├── index.js         # Bundled main entry point
│   └── *.map            # Source maps
├── action.yml           # GitHub Action metadata and interface
├── package.json         # Node.js dependencies and scripts
├── tsconfig.json        # TypeScript configuration
├── .github/workflows/   # CI/CD workflows
│   └── ci.yml           # CI workflow
└── AGENTS.md            # This file
```

## Key Technical Details

### Action Configuration (action.yml)

**Inputs:**
- `version` (default: 'stable'): k3s version to install (e.g., v1.28.5+k3s1, latest, stable, or channel like stable)
- `k3s-args` (default: '--write-kubeconfig-mode 644'): Additional arguments to pass to k3s installer
- `wait-for-ready` (default: 'true'): Wait for k3s cluster to be ready
- `timeout` (default: '120'): Timeout in seconds for readiness check

**Outputs:**
- `kubeconfig`: Path to kubeconfig file (`/etc/rancher/k3s/k3s.yaml`)

**Runtime:**
- Node.js 24 (`node24`)
- Main entry: `dist/index.js`
- Post hook: `dist/index.js` (same file, different execution path)

### Dependencies

**Production:**
- `@actions/core`: GitHub Actions toolkit for inputs/outputs/logging
- `@actions/exec`: Execute shell commands

**Development:**
- `@vercel/ncc`: Compiles TypeScript and bundles dependencies into single file
- `typescript`: TypeScript compiler

### Build Process

```bash
npm run build  # Uses @vercel/ncc to create dist/index.js
```

**Important:** The `dist/` directory must be committed to the repository for the action to work, as GitHub Actions cannot run build steps before execution.

## State Management

The action uses `core.saveState()` and `core.getState()` to coordinate between main and cleanup phases:

```typescript
// src/main.ts - Set state during main run
core.saveState('isPost', 'true');

// src/index.ts - Check state to determine phase
if (!core.getState('isPost')) {
  // Main run
  main()
} else {
  // Post run (cleanup)
  cleanup()
}
```

## System Requirements

- **OS:** Linux (tested on ubuntu-latest)
- **Permissions:** sudo access (available by default in GitHub Actions)
- **Network:** Internet access to download k3s install script and binaries

## Common Modification Scenarios

### Adding New Configuration Options

1. Add input to `action.yml`:
```yaml
inputs:
  new-option:
    description: 'Description of the new option'
    required: false
    default: 'default-value'
```

2. Read input in `src/main.ts`:
```typescript
const newOption = core.getInput('new-option');
```

3. Update README.md documentation

### Modifying Installation Logic

The installation logic is in `src/main.ts:39-84`. Key areas:
- Version/channel resolution: lines 48-55
- Install command construction: lines 46-58
- Service verification: lines 68-76

### Adjusting Cleanup Behavior

**CRITICAL:** Cleanup logic is in `src/cleanup.ts`. The cleanup is designed to be non-failing (uses `ignoreReturnCode: true`) to avoid breaking workflows if cleanup encounters issues.

**MANDATORY RULE:** Every modification to setup logic MUST have a corresponding cleanup operation. Review the "CRITICAL PRINCIPLE: SYSTEM STATE RESTORATION" section at the top of this document before making any changes.

## Testing Strategy

### Testing Checklist
**Setup Phase:**
- [ ] k3s installs successfully
- [ ] Cluster becomes ready within timeout
- [ ] kubectl can connect and list nodes

**Cleanup Phase (CRITICAL - MUST VERIFY):**
- [ ] Cleanup removes ALL k3s files
- [ ] k3s service is stopped and removed
- [ ] k3s-uninstall.sh script executes successfully
- [ ] No leftover processes or sockets
- [ ] No orphaned systemd services remain
- [ ] Rancher directories are cleaned up

## Debugging

### Enable Debug Logging
Set repository secret: `ACTIONS_STEP_DEBUG = true`

### Key Log Messages
- "Starting k3s setup..." - Main phase begins
- "k3s installed successfully" - Installation complete
- "k3s cluster is fully ready!" - Cluster ready
- "Starting k3s cleanup..." - Cleanup phase begins
- "k3s uninstalled successfully" - Cleanup complete

### Diagnostic Information
When cluster readiness times out, `showDiagnostics()` (`src/main.ts:174-200`) displays:
- k3s service status
- k3s journal logs (last 100 lines)
- Kubeconfig directory contents
- Listening ports
- Network interfaces
- Running containers (via k3s crictl)

## Related Resources

- **k3s Project**: https://k3s.io/
- **k3s GitHub**: https://github.com/k3s-io/k3s
- **k3s Documentation**: https://docs.k3s.io/
- **GitHub Actions Documentation**: https://docs.github.com/actions
- **Node.js Actions Guide**: https://docs.github.com/actions/creating-actions/creating-a-javascript-action

## Contributing

### Development Workflow
1. Make changes to `src/*.ts`
2. **CRITICAL:** If modifying setup phase, add corresponding cleanup operations
3. Run `npm run build` to compile
4. Commit both `src/` and `dist/` changes
5. Test in a workflow on GitHub - verify BOTH setup AND cleanup work correctly
6. Test that subsequent workflows still work after your action runs
7. Create pull request

### Release Process
Releases are typically managed via tags. Tags should follow semantic versioning (e.g., v1.0.0).
