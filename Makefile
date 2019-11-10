TEST_NAME=test-$(shell date +'%Y-%m-%d-%H-%M-%S')
TEST_FOLDER:=$(shell pwd)/out/$(TEST_NAME)

validate:
	echo $(TEST_NAME)
	git checkout -b $(TEST_NAME)
	mkdir -p $(TEST_FOLDER)
	docker build -t virtualtime .
	docker run -it -v $(TEST_FOLDER):/home/tmp virtualtime node test_2.js > out/$(TEST_NAME).log
	ffmpeg -i $(TEST_FOLDER)/%d.jpg out/$(TEST_NAME).mp4
	git add -u
	git add out/$(TEST_NAME).mp4
	git add out/$(TEST_NAME).log
	git commit -m "$(TEST_NAME)"
	git push -u origin $(TEST_NAME)