TEST_NAME=test-$(shell date +'%Y-%m-%d-%H-%M-%S')
TEST_FOLDER:=$(shell pwd)/out/$(TEST_NAME)

validate:
	echo $(TEST_NAME)
	git checkout -b $(TEST_NAME)
	mkdir -p $(TEST_FOLDER)
	docker build -t virtualtime .

	docker run -it virtualtime node test_1.js > log/$(TEST_NAME)/1.log
	docker run -it -v $(TEST_FOLDER):/home/tmp virtualtime node test_2.js > log/$(TEST_NAME)/2.log
	ffmpeg -i $(TEST_FOLDER)/%d.jpg log/$(TEST_NAME)/2.mp4

	git add -u
	git add log/$(TEST_NAME)

	git commit -m "$(TEST_NAME)"
	git push -u origin $(TEST_NAME)