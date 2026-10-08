// getVaultStats tool - Get statistics about the vault
import type { ToolSpec } from '../tool-registry'
import { getVaultStats as getStats } from '../vault'

async function getVaultStats(params: any) {
  try {
    const stats = await getStats()

    if (stats.count === 0) {
      return {
        success: true,
        result: 'Vault is empty. Use captureCurrentPage to start capturing pages.',
        stats
      }
    }

    const domains = Object.entries(stats.domains)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([domain, count]) => `  ${domain}: ${count} pages`)
      .join('\n')

    const oldestDate = stats.oldestEntry ? new Date(stats.oldestEntry).toLocaleDateString() : 'N/A'
    const newestDate = stats.newestEntry ? new Date(stats.newestEntry).toLocaleDateString() : 'N/A'

    const result = `Vault Statistics:

📊 Total Pages: ${stats.count}
📅 Date Range: ${oldestDate} to ${newestDate}

🌐 Top Domains:
${domains}

💡 Tip: Use searchVault to find pages by content`

    return {
      success: true,
      result,
      stats
    }
  } catch (error: any) {
    console.error('[getVaultStats] Error:', error)
    return { success: false, error: error.message }
  }
}

export const spec: ToolSpec = {
  name: 'getVaultStats',
  description: 'Get statistics about the vault (number of pages, domains, date range)',
  parameters: [],
  examples: [
    'User: "how many pages do you have saved?" → getVaultStats',
    'User: "show vault stats" → getVaultStats'
  ],
  spokenLine: 'Getting vault statistics'
}

export default getVaultStats
