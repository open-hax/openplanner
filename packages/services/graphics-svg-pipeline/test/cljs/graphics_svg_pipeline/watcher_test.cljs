(ns graphics-svg-pipeline.watcher-test
  (:require [cljs.test :refer-macros [deftest is testing]]
            [graphics-svg-pipeline.watcher :as watcher]))

;; ---------------------------------------------------------------------------
;; resolve-target-path
;; ---------------------------------------------------------------------------

(deftest resolve-target-path-inbox
  (testing "inbox files strip inbox prefix"
    (is (= "/tmp/graphics/bar.svg"
           (watcher/resolve-target-path "/tmp/graphics/inbox/bar.svg"
                                        "/tmp/graphics"
                                        "/tmp/graphics/inbox")))
    (is (= "/tmp/graphics/nested/deep.svg"
           (watcher/resolve-target-path "/tmp/graphics/inbox/nested/deep.svg"
                                        "/tmp/graphics"
                                        "/tmp/graphics/inbox")))))

(deftest resolve-target-path-devel
  (testing "devel root files strip devel prefix"
    (is (= "/tmp/graphics/foo.svg"
           (watcher/resolve-target-path "/tmp/graphics/foo.svg"
                                        "/tmp/graphics"
                                        "/tmp/graphics/inbox")))
    (is (= "/tmp/graphics/subdir/baz.svg"
           (watcher/resolve-target-path "/tmp/graphics/subdir/baz.svg"
                                        "/tmp/graphics"
                                        "/tmp/graphics/inbox")))))

(deftest resolve-target-path-out-of-root
  (testing "files outside watch roots throw"
    (is (thrown-with-msg?
          js/Error
          #"File outside watch roots"
          (watcher/resolve-target-path "/other/path/foo.svg"
                                       "/tmp/graphics"
                                       "/tmp/graphics/inbox")))))

(deftest resolve-target-path-realistic
  (testing "realistic devel/ layout from task spec"
    (let [graphics-dir "/project/Graphics"
          inbox-dir "/project/devel/inbox"]
      (is (= "/project/Graphics/foo.svg"
             (watcher/resolve-target-path "/project/devel/foo.svg"
                                          graphics-dir
                                          inbox-dir)))
      (is (= "/project/Graphics/bar.svg"
             (watcher/resolve-target-path "/project/devel/inbox/bar.svg"
                                          graphics-dir
                                          inbox-dir)))
      (is (= "/project/Graphics/subdir/baz.svg"
             (watcher/resolve-target-path "/project/devel/subdir/baz.svg"
                                          graphics-dir
                                          inbox-dir))))))

;; ---------------------------------------------------------------------------
;; dedup filter (testing via internal state)
;; ---------------------------------------------------------------------------

(deftest dedup-basic
  (testing "fresh path is not deduped"
    (let [path (str "/tmp/test-" (random-uuid) ".svg")]
      (is (false? (#'watcher/dedup? path)))))

  (testing "path becomes deduped after add-to-dedup!"
    (let [path (str "/tmp/test-" (random-uuid) ".svg")]
      (#'watcher/add-to-dedup! path)
      (is (true? (#'watcher/dedup? path)))))

  (testing "different paths are independent"
    (let [path-a (str "/tmp/test-" (random-uuid) ".svg")
          path-b (str "/tmp/test-" (random-uuid) ".svg")]
      (#'watcher/add-to-dedup! path-a)
      (is (true? (#'watcher/dedup? path-a)))
      (is (false? (#'watcher/dedup? path-b))))))

(deftest dedup-sha256
  (testing "sha256-hex returns consistent hex digest"
    (let [h1 (#'watcher/sha256-hex "hello")
          h2 (#'watcher/sha256-hex "hello")
          h3 (#'watcher/sha256-hex "world")]
      (is (= h1 h2))
      (is (not= h1 h3))
      (is (re-matches #"[0-9a-f]{64}" h1)))))
