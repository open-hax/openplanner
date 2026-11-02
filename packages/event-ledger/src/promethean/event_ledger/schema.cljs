(ns promethean.event-ledger.schema
  "Malli schemas for the event ledger envelope.
   Defines the canonical shape of every event that enters the ledger."
  (:require [malli.core :as m]
            [malli.error :as me]))

(def event-id-schema :string)
(def event-type-schema :string)
(def event-time-schema :string)
(def delivery-mode-schema [:enum "tell" "ask" "stream" "ack-required"])

(def from-to-schema
  [:map
   [:actor-id :string]
   [:actor-kind :string]
   [:actor-node {:optional true} :string]])

(def envelope-schema
  [:map
   [:event/id {:optional true} event-id-schema]
   [:event/type event-type-schema]
   [:event/time {:optional true} event-time-schema]
   [:event/from {:optional true} from-to-schema]
   [:event/to {:optional true} from-to-schema]
   [:causal/root {:optional true} :string]
   [:causal/parent {:optional true} :string]
   [:session/id {:optional true} :string]
   [:turn/id {:optional true} :string]
   [:delivery/mode {:optional true} delivery-mode-schema]
   [:delivery/id {:optional true} :string]
   [:payload {:optional true} :map]
   [:contracts {:optional true} [:vector :string]]
   [:expectations {:optional true} :map]])

(defn validate-envelope
  "Validate an incoming envelope against the schema.
   Returns {:valid true} or {:valid false :errors [...]}."
  [envelope]
  (if (m/validate envelope-schema envelope)
    {:valid true}
    {:valid false
     :errors (->> (me/humanize (m/explain envelope-schema envelope))
                  (mapcat (fn [[k vs]]
                            (map #(str (name k) ": " %) vs)))
                  vec)}))

(defn validate-envelope-js
  "JS-compatible validation wrapper."
  [envelope]
  (let [result (validate-envelope (js->clj envelope :keywordize-keys true))]
    (clj->js result)))
