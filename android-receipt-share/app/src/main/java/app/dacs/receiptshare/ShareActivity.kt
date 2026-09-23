package app.dacs.receiptshare

import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.Base64
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import org.json.JSONArray
import org.json.JSONObject

/**
 * Receives a shared receipt from the Android share sheet and hands it to the
 * existing share-capture.html wizard running in a WebView.
 *
 * Why a native app at all: Chrome on MIUI/HyperOS does not pass shared files to
 * a web app's share target — it delivers an empty multipart body. Reading the
 * file here, in a real app, avoids that hop entirely.
 *
 * Deliberately thin. It uploads nothing and knows nothing about projects,
 * expense types or Supabase. The web wizard keeps all of that, so the Expense
 * Inbox has one implementation, not two.
 */
class ShareActivity : AppCompatActivity() {

    private lateinit var web: WebView

    /** Files pulled off the share intent, read into memory, awaiting the page. */
    private val pending = mutableListOf<SharedFile>()

    data class SharedFile(val name: String, val mime: String, val bytes: ByteArray)

    companion object {
        private const val WIZARD_URL = "https://dacs-company.vercel.app/share-capture.html"
        private const val ORIGIN = "https://dacs-company.vercel.app"

        /** Refuse anything absurd rather than hanging the bridge on a huge file. */
        private const val MAX_BYTES = 25 * 1024 * 1024
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        readSharedFiles(intent)

        web = WebView(this)
        setContentView(web)

        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true          // the wizard's Supabase session lives here
            loadWithOverviewMode = true
            useWideViewPort = true
        }
        // The session must survive the activity being closed, or the user would
        // be asked to log in on every single share.
        android.webkit.CookieManager.getInstance().setAcceptCookie(true)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            android.webkit.CookieManager.getInstance().setAcceptThirdPartyCookies(web, true)
        }

        web.addJavascriptInterface(Bridge(), "DacsNative")

        web.webViewClient = object : WebViewClient() {
            // Keep our own origin inside the app; send anything else (a bank
            // link, a Google login popup target) to the real browser.
            override fun shouldOverrideUrlLoading(v: WebView?, req: WebResourceRequest?): Boolean {
                val url = req?.url?.toString() ?: return false
                if (url.startsWith(ORIGIN) || url.startsWith("https://accounts.google.com")) return false
                startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
                return true
            }
        }

        web.loadUrl(WIZARD_URL + "?native=1")

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (web.canGoBack()) web.goBack() else finish()
            }
        })
    }

    /** A second share while the app is already open. */
    override fun onNewIntent(newIntent: Intent) {
        super.onNewIntent(newIntent)
        setIntent(newIntent)
        pending.clear()
        readSharedFiles(newIntent)
        web.loadUrl(WIZARD_URL + "?native=1")
    }

    private fun readSharedFiles(from: Intent?) {
        if (from == null) return
        val uris: List<Uri> = when (from.action) {
            Intent.ACTION_SEND -> listOfNotNull(
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU)
                    from.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
                else @Suppress("DEPRECATION") from.getParcelableExtra(Intent.EXTRA_STREAM)
            )
            Intent.ACTION_SEND_MULTIPLE ->
                (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU)
                    from.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java)
                else @Suppress("DEPRECATION") from.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM))
                    ?.filterNotNull() ?: emptyList()
            else -> emptyList()
        }

        for (uri in uris) {
            try {
                val bytes = contentResolver.openInputStream(uri)?.use { it.readBytes() } ?: continue
                if (bytes.isEmpty() || bytes.size > MAX_BYTES) continue
                pending.add(SharedFile(displayName(uri), mimeOf(uri), bytes))
            } catch (_: Exception) {
                // An unreadable URI is skipped, not fatal — the wizard still
                // opens and the user can pick the file by hand.
            }
        }
    }

    private fun displayName(uri: Uri): String {
        try {
            contentResolver.query(uri, null, null, null, null)?.use { c ->
                val i = c.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME)
                if (i >= 0 && c.moveToFirst()) {
                    val n = c.getString(i)
                    if (!n.isNullOrBlank()) return n
                }
            }
        } catch (_: Exception) { }
        return uri.lastPathSegment?.substringAfterLast('/') ?: "receipt"
    }

    private fun mimeOf(uri: Uri): String =
        contentResolver.getType(uri) ?: "application/octet-stream"

    /**
     * What the page calls. Kept to two methods: how many files, and give me one.
     * Files go across base64-encoded because that survives the JS bridge intact;
     * a receipt photo is a few MB, which is well within what it will carry.
     */
    inner class Bridge {
        @JavascriptInterface
        fun fileCount(): Int = pending.size

        @JavascriptInterface
        fun fileAt(index: Int): String {
            if (index < 0 || index >= pending.size) return ""
            val f = pending[index]
            return JSONObject().apply {
                put("name", f.name)
                put("type", f.mime)
                put("data", Base64.encodeToString(f.bytes, Base64.NO_WRAP))
            }.toString()
        }

        /** Everything at once, for diagnostics on the page. */
        @JavascriptInterface
        fun manifest(): String {
            val arr = JSONArray()
            pending.forEach { f ->
                arr.put(JSONObject().apply {
                    put("name", f.name); put("type", f.mime); put("size", f.bytes.size)
                })
            }
            return arr.toString()
        }
    }
}
