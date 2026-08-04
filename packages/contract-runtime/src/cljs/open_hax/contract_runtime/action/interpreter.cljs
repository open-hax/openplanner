(ns open-hax.contract-runtime.action.interpreter
  "Action interpreter: executes the :action/* facet of a resource.

   Resolution order for an action map:
   1. :action/fn — inline anonymous action, executed directly (never registered)
   2. registered action kinds (registry handlers and run-action! defmethods)
   3. EDN action resources matched by :action/id — expanded into their
      :action/kind + :action/with and re-executed

   Before execution the action's :action/scope declaration (or the registered
   scope metadata for its kind) is resolved into a flat map of bound action
   fns, filter fns, and store instances, injected into ctx as :scope.

   Dependencies are injected via the :contract-runtime/deps key in config:
   - :run-action!  (fn [ctx action] -> Promise<result>)
   - :get-action   (fn [kind] -> action-handler or nil)
   - :get-scope-declaration (fn [kind] -> scope-decl map or nil)
   - :filter-fn    (fn [filter-id] -> filter-fn or nil)
   - :load-resources (fn [config] -> [{:resource/kind :resource/definition} ...])
   - :get-store    (fn [config store-id] -> IStore or nil)"
  (:require [open-hax.contract-runtime.action.anonymous :as anonymous]))

(defn- deps
  "Extract contract-runtime dependency functions from config."
  [config]
  (:contract-runtime/deps config))

(defn resolve-scope-decl
  "Resolve an :action/scope declaration {:actions [...] :filters [...]
   :stores [...]} into a flat scope map keyed by the declared ids."
  [config scope-decl]
  (let [{:keys [run-action! filter-fn get-store]} (deps config)]
    (merge
     (into {}
           (map (fn [action-key]
                  [action-key (fn [ctx action] (run-action! ctx action))]))
           (or (:actions scope-decl) []))
     (into {}
           (keep (fn [filter-id]
                   (when-let [f (filter-fn filter-id)]
                     [filter-id f])))
           (or (:filters scope-decl) []))
     (into {}
           (keep (fn [store-id]
                   (when-let [store (get-store config store-id)]
                     [store-id store])))
           (or (:stores scope-decl) [])))))

(defn- with-scope
  [ctx action]
  (let [{:keys [get-scope-declaration]} (deps (:config ctx))
        scope-decl (or (:action/scope action)
                       (get-scope-declaration (:action/kind action)))]
    (assoc ctx :scope (resolve-scope-decl (:config ctx) scope-decl))))

(defn- known-kind?
  [config kind]
  (let [{:keys [get-action run-action!]} (deps config)]
    (boolean (or (get-action kind)
                 ;; Check if run-action! handles this kind via multimethod
                 ;; This is a heuristic — the injection site should provide
                 ;; a get-action that covers all known kinds.
                 false))))

(defn- action-resource
  "Find an enabled action resource definition whose id matches an action kind."
  [config kind]
  (when (and config (keyword? kind))
    (let [{:keys [load-resources]} (deps config)]
      (->> (load-resources config)
           (filter #(= :action (:resource/kind %)))
           (map :resource/definition)
           (remove #(false? (:enabled %)))
           (some (fn [definition]
                   (when (or (= kind (:action/id definition))
                             (= kind (:resource/qualified-id definition)))
                     definition)))))))

(defn- expand-action-resource
  [action definition]
  (cond-> (assoc action
                 :action/kind (:action/kind definition)
                 :action/with (merge (:action/with definition)
                                     (:action/with action)))
    (:action/scope definition) (assoc :action/scope (:action/scope definition))
    (:action/fn definition) (assoc :action/fn (:action/fn definition))))

(defn execute!
  "Execute the action facet of a resource with scope injected into ctx.
   Returns a Promise of the action result."
  ([ctx action]
   (execute! ctx action 1))
  ([ctx action redirects]
   (if-let [inline (some-> (:action/fn action) anonymous/compile-action-fn)]
     (js/Promise.resolve (inline (with-scope ctx action) action))
     (let [{:keys [run-action! get-action]} (deps (:config ctx))
           kind (:action/kind action)]
       (cond
         (get-action kind)
         (run-action! (with-scope ctx action) action)

         (pos? redirects)
         (if-let [definition (action-resource (:config ctx) kind)]
           (execute! ctx (expand-action-resource action definition) (dec redirects))
           (run-action! ctx action))

         :else
         (run-action! ctx action))))))
