import Capacitor
import UIKit

class TenonViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(SecureStorePlugin())
    }
}
