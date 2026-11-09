package app.lwedflix.tv

import android.content.Context

/**
 * The desktop app's ad and tracker blocking (electron/adblock.js), for the
 * WebView. The domain list is read from that same file, copied in as an
 * asset at build time, so the two apps always block the same hosts. A
 * blocked domain covers its subdomains.
 */
class AdBlock(context: Context) {
    private val domains: Set<String> = run {
        val source = context.assets.open("adblock.js").bufferedReader().use { it.readText() }
        val list = Regex("""BLOCKED_DOMAINS\s*=\s*new Set\(\[(.*?)]\)""", RegexOption.DOT_MATCHES_ALL)
            .find(source)?.groupValues?.get(1)
            ?: error("BLOCKED_DOMAINS not found in adblock.js")
        Regex("""'([^']+)'""").findAll(list).map { it.groupValues[1].lowercase() }.toSet()
    }

    fun isBlockedHost(hostname: String?): Boolean {
        var host = hostname?.lowercase()?.trimEnd('.') ?: return false
        while (true) {
            if (host in domains) return true
            val dot = host.indexOf('.')
            if (dot == -1) return false
            host = host.substring(dot + 1)
        }
    }
}
