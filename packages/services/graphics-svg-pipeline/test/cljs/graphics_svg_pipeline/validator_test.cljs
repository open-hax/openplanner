(ns graphics-svg-pipeline.validator-test
  "Tests for SVG security validation."
  (:require [cljs.test :refer [deftest testing is]]
            [graphics-svg-pipeline.validator :as v]))

;; ---------------------------------------------------------------------------
;; Valid SVGs
;; ---------------------------------------------------------------------------

(def valid-minimal
  (str "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"100\" height=\"100\">"
       "<rect width=\"100\" height=\"100\" fill=\"red\"/>"
       "</svg>"))

(def valid-with-viewbox
  (str "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 100 100\">"
       "<circle cx=\"50\" cy=\"50\" r=\"40\"/>"
       "</svg>"))

(def valid-with-fragment-url
  (str "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"200\" height=\"200\">"
       "<defs><linearGradient id=\"goldGrad\">"
       "<stop offset=\"0%\" stop-color=\"gold\"/>"
       "</linearGradient></defs>"
       "<rect width=\"200\" height=\"200\" fill=\"url(#goldGrad)\"/>"
       "</svg>"))

(def valid-with-use-fragment
  (str "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"100\" height=\"100\">"
       "<defs><rect id=\"myRect\" width=\"50\" height=\"50\"/></defs>"
       "<use href=\"#myRect\" x=\"10\" y=\"10\"/>"
       "</svg>"))

(def valid-with-style
  (str "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"100\" height=\"100\">"
       "<style>.cls { fill: url(#goldGrad); }</style>"
       "<rect width=\"100\" height=\"100\"/>"
       "</svg>"))

;; ---------------------------------------------------------------------------
;; Invalid SVGs
;; ---------------------------------------------------------------------------

(def malformed-xml
  "<svg xmlns='http://www.w3.org/2000/svg'><rect></svg>")

(def missing-namespace
  (str "<svg width=\"100\" height=\"100\">"
       "<rect width=\"100\" height=\"100\"/>"
       "</svg>"))

(def with-script
  (str "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"100\" height=\"100\">"
       "<script>alert('xss')</script>"
       "<rect width=\"100\" height=\"100\"/>"
       "</svg>"))

(def with-foreign-object
  (str "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"100\" height=\"100\">"
       "<foreignObject><body onload='alert(1)'></body></foreignObject>"
       "</svg>"))

(def with-external-href
  (str "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"100\" height=\"100\">"
       "<use href=\"http://evil.com/payload.svg#x\"/>"
       "</svg>"))

(def with-external-xlink-href
  (str "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"100\" height=\"100\">"
       "<image xlink:href=\"https://evil.com/track.png\" width=\"1\" height=\"1\"/>"
       "</svg>"))

(def with-doctype-entity
  (str "<!DOCTYPE svg [<!ENTITY xxe SYSTEM \"file:///etc/passwd\">]>"
       "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"100\" height=\"100\">"
       "<text>&xxe;</text>"
       "</svg>"))

(def with-external-url-in-attr
  (str "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"100\" height=\"100\">"
       "<rect width=\"100\" height=\"100\" style=\"fill: url(http://evil.com/steal.css)\"/>"
       "</svg>"))

(def with-style-import
  (str "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"100\" height=\"100\">"
       "<style>@import url('http://evil.com/steal.css');</style>"
       "<rect width=\"100\" height=\"100\"/>"
       "</svg>"))

(def with-style-expression
  (str "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"100\" height=\"100\">"
       "<style>body { width: expression(alert(1)); }</style>"
       "<rect width=\"100\" height=\"100\"/>"
       "</svg>"))

(def with-missing-viewport
  (str "<svg xmlns=\"http://www.w3.org/2000/svg\">"
       "<rect fill=\"red\"/>"
       "</svg>"))

(def with-style-javascript
  (str "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"100\" height=\"100\">"
       "<style>a { background: url(javascript:alert(1)); }</style>"
       "<rect width=\"100\" height=\"100\"/>"
       "</svg>"))

(def with-event-handler
  (str "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"100\" height=\"100\">"
       "<rect width=\"100\" height=\"100\" onclick=\"alert(1)\"/>"
       "</svg>"))

;; ---------------------------------------------------------------------------
;; Tests
;; ---------------------------------------------------------------------------

(deftest valid-svg-passes-test
  (testing "Minimal valid SVG with width/height"
    (let [result (v/validate-svg valid-minimal)]
      (is (true? (:valid? result)))
      (is (some? (:svg result)))))

  (testing "Valid SVG with viewBox"
    (let [result (v/validate-svg valid-with-viewbox)]
      (is (true? (:valid? result)))))

  (testing "url(#id) is allowed"
    (let [result (v/validate-svg valid-with-fragment-url)]
      (is (true? (:valid? result)))))

  (testing "use href with #fragment is allowed"
    (let [result (v/validate-svg valid-with-use-fragment)]
      (is (true? (:valid? result)))))

  (testing "Style with url(#id) is allowed"
    (let [result (v/validate-svg valid-with-style)]
      (is (true? (:valid? result))))))

(deftest malformed-xml-fails-test
  (testing "Malformed XML is rejected"
    (let [result (v/validate-svg malformed-xml)]
      (is (false? (:valid? result)))
      (is (some #(= :malformed/xml-parse-error (:type %))
                (:errors result))))))

(deftest missing-namespace-fails-test
  (testing "SVG without xmlns is rejected"
    (let [result (v/validate-svg missing-namespace)]
      (is (false? (:valid? result)))
      (is (some #(= :malformed/wrong-namespace (:type %))
                (:errors result))))))

(deftest script-injection-rejected-test
  (testing "<script> element is rejected"
    (let [result (v/validate-svg with-script)]
      (is (false? (:valid? result)))
      (is (some #(= :security/script-element (:type %))
                (:errors result)))))

  (testing "<foreignObject> is rejected"
    (let [result (v/validate-svg with-foreign-object)]
      (is (false? (:valid? result)))
      (is (some #(= :security/foreign-object (:type %))
                (:errors result))))))

(deftest external-href-rejected-test
  (testing "http: href on <use> is rejected"
    (let [result (v/validate-svg with-external-href)]
      (is (false? (:valid? result)))
      (is (some #(= :security/external-href (:type %))
                (:errors result)))))

  (testing "https: xlink:href on <image> is rejected"
    (let [result (v/validate-svg with-external-xlink-href)]
      (is (false? (:valid? result)))
      (is (some #(= :security/external-href (:type %))
                (:errors result))))))

(deftest url-fragment-allowed-test
  (testing "url(#id) in fill attribute is allowed"
    (let [result (v/validate-svg valid-with-fragment-url)]
      (is (true? (:valid? result))))))

(deftest external-url-rejected-test
  (testing "url(http://...) in inline style is rejected"
    (let [result (v/validate-svg with-external-url-in-attr)]
      (is (false? (:valid? result)))
      (is (some #(= :security/external-url (:type %))
                (:errors result))))))

(deftest doctype-entity-rejected-test
  (testing "<!DOCTYPE> with entity is rejected"
    (let [result (v/validate-svg with-doctype-entity)]
      (is (false? (:valid? result)))
      (is (some #(= :security/doctype-or-entity (:type %))
                (:errors result))))))

(deftest style-injection-rejected-test
  (testing "@import with external URL in <style> is rejected"
    (let [result (v/validate-svg with-style-import)]
      (is (false? (:valid? result)))
      (is (some #(= :security/style-import (:type %))
                (:errors result)))))

  (testing "expression() in <style> is rejected"
    (let [result (v/validate-svg with-style-expression)]
      (is (false? (:valid? result)))
      (is (some #(= :security/style-expression (:type %))
                (:errors result)))))

  (testing "javascript: scheme in <style> is rejected"
    (let [result (v/validate-svg with-style-javascript)]
      (is (false? (:valid? result)))
      (is (some #(= :security/style-javascript (:type %))
                (:errors result))))))

(deftest missing-viewport-fails-test
  (testing "SVG without width/height/viewBox is rejected"
    (let [result (v/validate-svg with-missing-viewport)]
      (is (false? (:valid? result)))
      (is (some #(= :malformed/missing-viewport (:type %))
                (:errors result))))))

(deftest event-handler-rejected-test
  (testing "onclick attribute is rejected"
    (let [result (v/validate-svg with-event-handler)]
      (is (false? (:valid? result)))
      (is (some #(= :security/event-attribute (:type %))
                (:errors result))))))

(deftest size-limit-test
  (testing "SVG exceeding max-size is rejected"
    (let [big-svg (str "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"1\" height=\"1\">"
                       "<rect width=\"1\" height=\"1\" fill=\"" (apply str (repeat (* 6 1024 1024) "x")) "\"/>"
                       "</svg>")
          result (v/validate-svg big-svg)]
      (is (false? (:valid? result)))
      (is (some #(= :malformed/size-exceeded (:type %))
                (:errors result))))))
