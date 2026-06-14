(ns graphics-svg-pipeline.validator
  "SVG security validator using @xmldom/xmldom DOMParser.

   Pure validation logic — no I/O. Returns {:valid? true :svg dom} or
   {:valid? false :errors [...]}. Quarantine side-effects live in a
   separate ns (quarantine)."
  (:require [clojure.string :as str]
            ["@xmldom/xmldom" :as xmldom]))

;; ---------------------------------------------------------------------------
;; DOMParser singleton
;; ---------------------------------------------------------------------------

(def ^:private DOMParser (.-DOMParser xmldom))

(def ^:private svg-ns "http://www.w3.org/2000/svg")

(def default-opts
  "Default validation options."
  {:max-size (* 5 1024 1024) ;; 5 MB
   :graphics-dir nil})

;; ---------------------------------------------------------------------------
;; Helpers
;; ---------------------------------------------------------------------------

(defn- node-name
  "Return the lowercase tag name of a DOM node."
  [node]
  (some-> (.-nodeName node) str/lower-case))

(defn- node-local-name
  "Return the lowercase localName of a DOM node."
  [node]
  (some-> (.-localName node) str/lower-case))

(defn- attr-value
  "Return the value of attribute `attr` on `node`, or nil."
  [node attr]
  (when (.hasAttribute node attr)
    (.getAttribute node attr)))

(defn- child-nodes-seq
  "Return a seq of child DOM nodes."
  [node]
  (let [children (.-childNodes node)
        len (.-length children)]
    (mapv #(.item children %) (range len))))

(defn- all-elements-seq
  "Depth-first traversal of all element nodes under `root`."
  [root]
  (when (= 1 (.-nodeType root))
    (cons root
          (mapcat all-elements-seq (child-nodes-seq root)))))

(defn- parse-errors
  "Return a seq of parse error maps from a DOMParser instance, or nil."
  [parser]
  (let [err (.-parseError parser)]
    (when (and err (not= (.-errorCode err) "NO_ERROR"))
      [{:type :malformed/xml-parse-error
        :line (or (.-lineNumber err) 0)
        :message (str (.-reason err) " at line " (.-lineNumber err))}])))

(defn- has-script-or-foreign-object?
  "True if `elem` is a <script> or <foreignObject>."
  [elem]
  (let [ln (node-local-name elem)]
    (or (= ln "script") (= ln "foreign-object"))))

(defn- dangerous-schemes
  "Return true if `s` contains a dangerous URI scheme."
  [s]
  (let [lower (str/lower-case (str/trim (str s)))]
    (or (str/starts-with? lower "http:")
        (str/starts-with? lower "https:")
        (str/starts-with? lower "ftp:")
        (str/starts-with? lower "data:")
        (str/starts-with? lower "javascript:")
        (str/starts-with? lower "vbscript:")
        (str/starts-with? lower "file:"))))

(defn- href-check
  "Validate an href/xlink:href value. Only #fragment refs are allowed.
   Returns an error map if invalid, nil if valid."
  [node attr-name]
  (when-let [val (attr-value node attr-name)]
    (let [trimmed (str/trim val)]
      (when-not (or (str/starts-with? trimmed "#")
                    (str/blank? trimmed))
        (when (dangerous-schemes trimmed)
          {:type :security/external-href
           :line (or (.-lineNumber node) 0)
           :message (str "External href not allowed on <" (node-local-name node)
                         "> " attr-name "=\"" trimmed "\"")})))))

(defn- check-url-function
  "Check url() values in a string. Reject non-fragment schemes.
   Returns a seq of error maps."
  [s context-line]
  (let [re #"url\(\s*['\"]?\s*([^)\s'\"#][^)\s'\"#]*)\s*['\"]?\s*\)"
        matches (re-seq re (str s))]
    (keep (fn [[_ url-ref]]
            (when (dangerous-schemes url-ref)
              {:type :security/external-url
               :line context-line
               :message (str "External url not allowed: url(" url-ref ")")}))
          matches)))

(defn- check-style-content
  "Validate <style> block content. Returns a seq of error maps."
  [style-text line-number]
  (let [text (str style-text)
        lower (str/lower-case text)
        errors []
        ;; @import check
        errors (if (re-find #"@import\s+url\s*\(\s*['\"]?\s*(https?|ftp|data|javascript|vbscript):" lower)
                 (conj errors {:type :security/style-import
                               :line line-number
                               :message "@import with external URL not allowed in <style>"})
                 errors)
        ;; expression() check
        errors (if (re-find #"expression\s*\(" lower)
                 (conj errors {:type :security/style-expression
                               :line line-number
                               :message "expression() not allowed in <style>"})
                 errors)
        ;; javascript: check
        errors (if (str/includes? lower "javascript:")
                 (conj errors {:type :security/style-javascript
                               :line line-number
                               :message "javascript: scheme not allowed in <style>"})
                 errors)
        ;; url() check
        errors (into errors (check-url-function text line-number))]
    errors))

(defn- event-attr?
  "True if the attribute name is an on* event handler."
  [attr-name]
  (str/starts-with? (str/lower-case (str attr-name)) "on"))

(defn- has-doctype-or-entity?
  "True if the raw SVG string contains <!DOCTYPE or <!ENTITY declarations."
  [raw-svg]
  (let [upper (str/upper-case raw-svg)]
    (or (str/includes? upper "<!DOCTYPE")
        (str/includes? upper "<!ENTITY"))))

(defn- check-viewport
  "Check that root <svg> has width/height or viewBox. Returns error or nil."
  [root]
  (let [has-wh (and (attr-value root "width")
                    (attr-value root "height"))
        has-vb (some? (attr-value root "viewBox"))]
    (when-not (or has-wh has-vb)
      {:type :malformed/missing-viewport
       :line (or (.-lineNumber root) 0)
       :message "SVG must have width/height or viewBox attributes"})))

;; ---------------------------------------------------------------------------
;; Core validation
;; ---------------------------------------------------------------------------

(defn validate-svg
  "Validate an SVG string against security and structural rules.
   Returns {:valid? true :svg parsed-dom} or {:valid? false :errors [...]}.
   Pure function — no side effects."
  ([svg-string]
   (validate-svg svg-string default-opts))
  ([svg-string {:keys [max-size] :or {max-size (:max-size default-opts)}}]
   (let [errors []
         ;; Size check
         errors (if (> (.-length (str svg-string)) max-size)
                  (conj errors {:type :malformed/size-exceeded
                                :line 0
                                :message (str "SVG exceeds maximum size of "
                                              (quot max-size (* 1024 1024)) "MB")})
                  errors)]
     ;; Early return if size exceeded
     (if (seq errors)
       {:valid? false :errors errors}
       ;; Parse
       (let [parser (DOMParser.)
             doc (.parseFromString parser (str svg-string) "image/svg+xml")
             parse-errs (parse-errors parser)]
         (if (seq parse-errs)
           {:valid? false :errors (vec parse-errs)}
           ;; Walk DOM
           (let [root (.-documentElement doc)
                 root-tag (node-local-name root)
                 root-ns (.getAttribute root "xmlns")
                 all-elems (all-elements-seq root)
                 errors []
                 ;; Root tag check
                 errors (if (not= root-tag "svg")
                          (conj errors {:type :malformed/wrong-root
                                        :line 0
                                        :message (str "Root element must be <svg>, found <" root-tag ">")})
                          errors)
                 ;; Namespace check
                 errors (if (not= root-ns svg-ns)
                          (conj errors {:type :malformed/wrong-namespace
                                        :line (or (.-lineNumber root) 0)
                                        :message (str "SVG namespace must be " svg-ns
                                                      ", found \"" root-ns "\"")})
                          errors)
                 ;; DOCTYPE/ENTITY check
                 errors (if (has-doctype-or-entity? (str svg-string))
                          (conj errors {:type :security/doctype-or-entity
                                        :line 0
                                        :message "<!DOCTYPE> and <!ENTITY> declarations not allowed"})
                          errors)
                 ;; Viewport check
                 errors (if-let [vp-err (check-viewport root)]
                          (conj errors vp-err)
                          errors)
                 ;; Element-level checks
                 errors (reduce
                         (fn [acc elem]
                           (let [ln (node-local-name elem)
                                 line (or (.-lineNumber elem) 0)
                                  acc (if (has-script-or-foreign-object? elem)
                                        (conj acc {:type (if (= ln "script")
                                                           :security/script-element
                                                           :security/foreign-object)
                                                    :line line
                                                    :message (str "<" ln "> element not allowed")})
                                       acc)
                                 ;; Event attributes
                                 attrs (when-let [attrs (.-attributes elem)]
                                         (mapv #(.item attrs %) (range (.-length attrs))))
                                 acc (reduce
                                      (fn [a attr]
                                        (if (event-attr? (.-name attr))
                                          (conj a {:type :security/event-attribute
                                                   :line line
                                                   :message (str "Event attribute \"" (.-name attr)
                                                                 "\" not allowed on <" ln ">")})
                                          a))
                                      acc attrs)
                                 ;; href checks
                                 acc (if-let [h (href-check elem "href")]
                                       (conj acc h)
                                       acc)
                                 acc (if-let [h (href-check elem "xlink:href")]
                                       (conj acc h)
                                       acc)
                                 ;; <style> content check
                                 acc (if (= ln "style")
                                       (let [content (str/join (map #(.-textContent %) (child-nodes-seq elem)))
                                             style-errs (check-style-content content line)]
                                         (into acc style-errs))
                                       acc)
                                 ;; url() in inline style
                                 acc (if-let [inline-style (attr-value elem "style")]
                                       (into acc (check-url-function inline-style line))
                                       acc)]
                             acc))
                         errors all-elems)]
             (if (seq errors)
               {:valid? false :errors (vec errors)}
               {:valid? true :svg doc}))))))))
