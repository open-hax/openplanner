(ns open-hax.contract-runtime.registry.resource
  "Generic registry protocol for EDN-described resources.

   A registry advertises resources of one kind. Actions, triggers, schedules,
   roles, and the rest are separate resource kinds; all can share this registry
   protocol without pretending the resource definition itself is a contract.

   Dependencies are injected via the :contract-runtime/deps key in config:
   - :list-resource-ids (fn [config resource-kind] -> [id ...])
   - :get-resource      (fn [config resource-kind resource-id] -> record or nil)
   - :resource-class    (fn [resource-kind] -> class-name string)")

(defprotocol Registry
  (registry-id [registry]
    "Return the stable registry id keyword.")
  (registry-resource-kind [registry]
    "Return the singular resource kind owned by this registry.")
  (registered-resource-ids [registry config]
    "Return sorted resource ids visible to this registry.")
  (registry-resource [registry config resource-id]
    "Return one resource record by id, or nil.")
  (registry-catalog [registry config]
    "Return a catalog map for this registry."))

(defrecord EdnResourceRegistry [id resource-kind]
  Registry
  (registry-id [_] id)
  (registry-resource-kind [_] resource-kind)
  (registered-resource-ids [_ config]
    (let [{:keys [list-resource-ids]} (:contract-runtime/deps config)]
      (list-resource-ids config resource-kind)))
  (registry-resource [_ config resource-id]
    (let [{:keys [get-resource]} (:contract-runtime/deps config)]
      (get-resource config resource-kind resource-id)))
  (registry-catalog [this config]
    {:catalog/resources {(registry-resource-kind this)
                         (registered-resource-ids this config)}}))

(def registry-specs
  [{:id :registry/actions :kind :action}
   {:id :registry/rules :kind :rule}
   {:id :registry/triggers :kind :trigger}
   {:id :registry/actors :kind :actor}
   {:id :registry/users :kind :user}
   {:id :registry/agents :kind :agent}
   {:id :registry/capabilities :kind :capability}
   {:id :registry/roles :kind :role}
   {:id :registry/workflows :kind :workflow}
   {:id :registry/schedules :kind :schedule}
   {:id :registry/sources :kind :source}])

(defn make-registry
  [{:keys [id kind]}]
  (->EdnResourceRegistry id kind))

(def registries-by-kind
  (->> registry-specs
       (map make-registry)
       (map (fn [registry]
              [(registry-resource-kind registry) registry]))
       (into {})))

(def actions-registry (get registries-by-kind :action))
(def rules-registry (get registries-by-kind :rule))
(def triggers-registry (get registries-by-kind :trigger))
(def actors-registry (get registries-by-kind :actor))
(def users-registry (get registries-by-kind :user))
(def agents-registry (get registries-by-kind :agent))
(def capabilities-registry (get registries-by-kind :capability))
(def roles-registry (get registries-by-kind :role))
(def workflows-registry (get registries-by-kind :workflow))
(def schedules-registry (get registries-by-kind :schedule))
(def sources-registry (get registries-by-kind :source))

(defn registry
  [resource-kind]
  (get registries-by-kind resource-kind))

(defn catalog
  ([config]
   (catalog config (keys registries-by-kind)))
  ([config resource-kinds]
   (let [{:keys [list-resource-ids]} (:contract-runtime/deps config)]
     {:catalog/resources
      (->> resource-kinds
           (keep (fn [resource-kind]
                   (when-let [owned-registry (registry resource-kind)]
                     [(registry-resource-kind owned-registry)
                      (list-resource-ids config resource-kind)])))
           (into {}))})))
