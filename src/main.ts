import * as core from '@actions/core';
import * as exec from '@actions/exec';
import { promises as fs } from 'fs';

export async function main(): Promise<void> {
  try {
    core.info('Starting k3s setup...');
    
    // Set state to indicate this is not post-run
    core.saveState('isPost', 'true');
    
    // Get inputs
    const version = core.getInput('version') || 'stable';
    const k3sArgs = core.getInput('k3s-args') || '--write-kubeconfig-mode 644';
    const waitForReady = core.getInput('wait-for-ready') === 'true';
    const timeout = parseInt(core.getInput('timeout') || '120', 10);
    
    core.info(`Configuration: version=${version}, k3s-args="${k3sArgs}", wait-for-ready=${waitForReady}, timeout=${timeout}s`);
    
    // Step 1: Install k3s
    await installK3s(version, k3sArgs);
    
    // Step 2: Wait for cluster ready (if requested)
    if (waitForReady) {
      await waitForClusterReady(timeout);
    } else {
      // Even if not waiting, set the kubeconfig output
      const kubeconfigPath = '/etc/rancher/k3s/k3s.yaml';
      core.setOutput('kubeconfig', kubeconfigPath);
      core.exportVariable('KUBECONFIG', kubeconfigPath);
    }
    
    core.info('✓ k3s setup completed successfully!');
  } catch (error) {
    throw error;
  }
}

async function installK3s(version: string, k3sArgs: string): Promise<void> {
  core.startGroup('Installing k3s');
  
  try {
    core.info(`Installing k3s ${version}...`);
    
    // Prepare installation command
    let installCmd = 'curl -sfL https://get.k3s.io | ';
    
    // Add version if not using default channel
    if (version && version !== 'stable' && version !== 'latest') {
      installCmd += `INSTALL_K3S_VERSION="${version}" `;
    } else if (version === 'latest') {
      installCmd += 'INSTALL_K3S_CHANNEL="latest" ';
    } else {
      installCmd += 'INSTALL_K3S_CHANNEL="stable" ';
    }
    
    // Add k3s arguments
    installCmd += `sh -s - ${k3sArgs}`;
    
    core.info(`  Install command: ${installCmd}`);
    
    await exec.exec('bash', ['-c', installCmd]);
    
    core.info('  Waiting for k3s service to start...');
    await new Promise(resolve => setTimeout(resolve, 10000));
    
    // Verify service is running
    const serviceStatus = await exec.exec('sudo', ['systemctl', 'is-active', 'k3s'], { 
      ignoreReturnCode: true,
      silent: true 
    });
    
    if (serviceStatus !== 0) {
      await showDiagnostics();
      throw new Error('k3s service failed to start');
    }
    
    core.info('✓ k3s installed successfully');
  } catch (error) {
    throw new Error(`Failed to install k3s: ${error}`);
  } finally {
    core.endGroup();
  }
}

async function waitForClusterReady(timeoutSeconds: number): Promise<void> {
  core.startGroup('Waiting for cluster ready');
  
  try {
    core.info(`Waiting for k3s cluster to be ready (timeout: ${timeoutSeconds}s)...`);
    
    const startTime = Date.now();
    const kubeconfigPath = '/etc/rancher/k3s/k3s.yaml';
    
    while (true) {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      
      if (elapsed > timeoutSeconds) {
        core.error('Timeout waiting for cluster to be ready');
        await showDiagnostics();
        throw new Error('Timeout waiting for cluster to be ready');
      }
      
      // Check if k3s service is active
      const serviceResult = await exec.exec('sudo', ['systemctl', 'is-active', 'k3s'], { 
        ignoreReturnCode: true,
        silent: true 
      });
      
      if (serviceResult === 0) {
        // Check if kubeconfig exists and is accessible
        try {
          await fs.access(kubeconfigPath);
          
          // Verify kubectl can connect to API server
          const kubectlResult = await exec.exec('kubectl', ['--kubeconfig', kubeconfigPath, 'get', 'nodes', '--no-headers'], {
            ignoreReturnCode: true,
            silent: true
          });
          
          if (kubectlResult === 0) {
            // Verify node is Ready
            const nodeReady = await exec.exec('bash', ['-c', 
              `kubectl --kubeconfig ${kubeconfigPath} get nodes --no-headers | grep -q " Ready "`
            ], {
              ignoreReturnCode: true,
              silent: true
            });
            
            if (nodeReady === 0) {
              core.info('  Node is Ready');
              
              // Verify core system pods are running
              const systemPodsReady = await exec.exec('bash', ['-c',
                `kubectl --kubeconfig ${kubeconfigPath} get pods -n kube-system --no-headers | grep -v Running | grep -v Completed | wc -l`
              ], {
                ignoreReturnCode: true,
                silent: true
              });
              
              if (systemPodsReady === 0) {
                core.info('  All system pods are running');
                
                // Set output and export environment variable
                core.setOutput('kubeconfig', kubeconfigPath);
                core.exportVariable('KUBECONFIG', kubeconfigPath);
                core.info(`  KUBECONFIG exported: ${kubeconfigPath}`);
                
                // Show cluster info
                await exec.exec('kubectl', ['--kubeconfig', kubeconfigPath, 'get', 'nodes']);
                await exec.exec('kubectl', ['--kubeconfig', kubeconfigPath, 'version']);
                
                break;
              }
            }
          }
        } catch {
          // Continue waiting
        }
      }
      
      core.info(`  Cluster not ready yet, waiting... (${elapsed}/${timeoutSeconds}s)`);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
    
    core.info('✓ k3s cluster is fully ready!');
  } catch (error) {
    throw new Error(`Failed waiting for cluster: ${error}`);
  } finally {
    core.endGroup();
  }
}

async function showDiagnostics(): Promise<void> {
  core.startGroup('Diagnostic Information');
  
  try {
    core.info('=== k3s Service Status ===');
    await exec.exec('sudo', ['systemctl', 'status', 'k3s'], { ignoreReturnCode: true });
    
    core.info('=== k3s Logs (last 100 lines) ===');
    await exec.exec('sudo', ['journalctl', '-u', 'k3s', '-n', '100', '--no-pager'], { ignoreReturnCode: true });
    
    core.info('=== Kubeconfig Directory ===');
    await exec.exec('ls', ['-laR', '/etc/rancher/k3s/'], { ignoreReturnCode: true });
    
    core.info('=== Listening Ports ===');
    await exec.exec('sudo', ['ss', '-tlnp'], { ignoreReturnCode: true });
    
    core.info('=== Network Interfaces ===');
    await exec.exec('ip', ['addr'], { ignoreReturnCode: true });
    
    core.info('=== Running Containers ===');
    await exec.exec('sudo', ['k3s', 'crictl', 'ps'], { ignoreReturnCode: true });
  } catch (error) {
    core.warning(`Failed to gather diagnostics: ${error}`);
  } finally {
    core.endGroup();
  }
}
