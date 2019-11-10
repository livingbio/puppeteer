test:
	TEST_NAME = test-`date +'%y.%m.%d %H:%M:%S'`
	git checkout -b $TEST_NAME
	rm mount/*
	docker build -t virtualtime .
	docker run -it --entrypoint bash -v $(pwd)/mount:/home/tmp virtualtime node test_2.js
	docker run -it -v $(pwd)/mount:/home/tmp virtualtime node test_2.js
	ffmpeg -i mount/%d.jpg $TEST_NAME.mp4
	git add -u
	git add $TEST_NAME.mp4
	git commit -m "$TEST_NAME"
	git push -u origin $TEST_NAME