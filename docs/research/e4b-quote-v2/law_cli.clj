;; SPDX-License-Identifier: GPL-3.0-or-later
(ns law-cli
  (:require [cheshire.core :as json]))
(load-file (str (.getParent (java.io.File. *file*)) "/src/research/e4b_quote_law.cljc"))
(require '[research.e4b-quote-law :as law])
(let [{:keys [operation fixture host condition sources-json transport] :as input}
      (json/parse-string (slurp *in*) true)]
  (println (json/generate-string
            (case operation
              "fixture" (law/fixture-admission fixture)
              "host" (law/local-admission host)
              "request" (law/request condition sources-json)
              "score" (law/score (:case input) transport)
              (throw (ex-info "Unknown quote experiment operation" {:operation operation}))))))
