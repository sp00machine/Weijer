package com.ashtronics.weijer

import android.annotation.SuppressLint
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.enableEdgeToEdge
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import android.util.Log
import android.webkit.ConsoleMessage
import android.webkit.CookieManager
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import org.json.JSONObject
import android.graphics.Color
import android.view.Choreographer
import android.view.View
import android.widget.FrameLayout
import android.widget.ImageView

class MainActivity : AppCompatActivity() {

    private val pwaURL = "https://meijer.ashtronics.xyz"
    private val meijerURL = "https://www.meijer.com/shopping/accounts.html"

    private lateinit var webView: WebView

//    Weijer DVD logo bouncer
    private lateinit var overlay: FrameLayout
    private lateinit var bouncer: ImageView
    private var vx = 6f      // pixels per frame
    private var vy = 4f
    private var bouncing = false



    //a meijer cart waiting to be sent over to the pwa
    //volatile bc claude says the ui thread and the js thread could create race conditions
    @Volatile private var pendingCart: String? = null

    inner class CartBridge {
        //"@JavascriptInterface" -> callable from js at window.Android.*
        @JavascriptInterface
        fun onCart(json: String) {
            Log.d("yeah and it worked", json)
            pendingCart = json
            runOnUiThread { setOverlayVisible(true); webView.loadUrl(pwaURL) }
        }

        @JavascriptInterface
        fun onError(error: String) {
            Log.d("yeah but theres an error", error)
//            runOnUiThread { setOverlayVisible(false) }
        }

        //loads meijer into the webview (wait hold on a sec claude why can't we just directly navigate there from the pwa?)
        @JavascriptInterface
        fun startCartImport() {
            runOnUiThread { setOverlayVisible(true); webView.loadUrl(meijerURL) }
        }

        //manually show overlay
        @JavascriptInterface
        fun showOverlay() {
            runOnUiThread { setOverlayVisible(true) }
        }

        //manually hide overlay
        @JavascriptInterface
        fun hideOverlay() {
            runOnUiThread { setOverlayVisible(false) }
        }
    }

    //"static" but more kotliny
    companion object {
        private val CART_JS = """
            (async () => {
                try {
//                    alert("ok doing thing?");
                    const timestamp = Math.floor(Date.now() / 1000);
                    const cart = await fetch ("/bin/meijer/cart/userstate?timestamp="+timestamp);
                    const data = await cart.json();
    
                    if (!data.isUserSignedIn) {
                        window.Android.onError("not signed in");
                        return;
                    }
                    
                    const groups = data.cart?.cartGroups ?? [];
                    const store = groups[0]?.pointOfService?.name ?? '245';
                    const items = groups.flatMap(cg => cg.entries).map(item => ({url: "https://www.meijer.com/shopping/product/null/" + item.product.code + ".html", quantity: item.quantity, name: item.product.name}));
    
//                    console.log("maybe?", JSON.stringify(items));
                    window.Android.onCart(JSON.stringify({store, items}));
                } catch(e) {
                    console.log("ya fucked up\n\n" + e);
                }
            })();
        """.trimIndent()

        private val LOGO_JS = """
            const imgs = document.querySelectorAll('img[alt="Meijer logo"]');
            imgs.forEach((img) => img.src="https://meijer.ashtronics.xyz/weijer.svg")
        """.trimIndent()
    }


    private val frame = object : Choreographer.FrameCallback {
        override fun doFrame(t: Long) {
            if (!bouncing) return
            val maxX = (overlay.width - bouncer.width).toFloat()
            val maxY = (overlay.height - bouncer.height).toFloat()
            if (maxX > 0f && maxY > 0f) {
                var x = bouncer.translationX + vx
                var y = bouncer.translationY + vy
                if (x <= 0f || x >= maxX) { vx = -vx; x = x.coerceIn(0f, maxX); recolor() }
                if (y <= 0f || y >= maxY) { vy = -vy; y = y.coerceIn(0f, maxY); recolor() }
                bouncer.translationX = x
                bouncer.translationY = y
            }
            Choreographer.getInstance().postFrameCallback(this)
        }
    }


    //more overlay/dvd bouncer stuff
    private fun recolor() {
        bouncer.setColorFilter(Color.HSVToColor(floatArrayOf((0..360).random().toFloat(), 0.7f, 1f)))
    }

    private fun startBounce() {
        if (bouncing) return
        bouncing = true
        Choreographer.getInstance().postFrameCallback(frame)
    }

    private fun stopBounce() {
        bouncing = false
        Choreographer.getInstance().removeFrameCallback(frame)
    }


    private fun setOverlayVisible(visible: Boolean) {
        if (visible) {
            overlay.visibility = View.VISIBLE
            startBounce()
        } else {
            overlay.visibility = View.GONE
            stopBounce()
        }
    }


    //main
    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {

        //boilerplate stuff
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContentView(R.layout.activity_main)
        ViewCompat.setOnApplyWindowInsetsListener(findViewById(R.id.main)) { v, insets ->
            val systemBars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            v.setPadding(systemBars.left, systemBars.top, systemBars.right, systemBars.bottom)
            insets
        }

        //grabby
        webView = findViewById<WebView>(R.id.webview)
        overlay = findViewById<FrameLayout>(R.id.overlay)
        bouncer = findViewById<ImageView>(R.id.bouncer)


        //config
        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        webView.addJavascriptInterface(CartBridge(), "Android") //allows js to call kotlin

        //makes alerts work and diverts console.log to android Log.d
        webView.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(consoleMessage: ConsoleMessage): Boolean {
                Log.d("yeag there's some console stuff", consoleMessage.message())
                return true
            }
        }


        //            _  _
        //me want    (.)(')
        //more...   / ___, \  .-.
        //    .-. _ \ '--' / (:::)
        //   (:::{ '-`--=-`-' }"`
        //    `-' `"/      \"`
        //          \      /
        //         _/  /\  \_
        //  jgs   {   /  \   }
        //         `"`    `"`
        //(cookies)
        val cookieManager = CookieManager.getInstance()
        cookieManager.setAcceptCookie(true)
        cookieManager.setAcceptThirdPartyCookies(webView, true) //just in case...


        //setup
        webView.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView, url: String) {
                when {
                    url.contains("meijer.ashtronics.xyz") -> {
                        if (pendingCart != null) {
                            view.evaluateJavascript(
                                "window.__deliverCart(${JSONObject.quote(pendingCart)})",
                                null
                            )
                            pendingCart = null
                        } else setOverlayVisible(false) //show the actual page if there's nothing to add to the cart. otherwise, the pwa will handle that
                    }
                    url.contains("meijer.com") -> {
                        view.evaluateJavascript(CART_JS, null)
                        view.evaluateJavascript(LOGO_JS, null)

                        if(url.contains("oauth2")) { //meijer signin page
                            setOverlayVisible(false)
                        }
                    }
                }
                cookieManager.flush()
            }
        }

        webView.loadUrl(pwaURL)
//        webView.loadUrl("https://meijer.com")

        Log.d("yeah", "yeah")

    }

    override fun onStop() {
        super.onStop()
        CookieManager.getInstance().flush()
    }
}